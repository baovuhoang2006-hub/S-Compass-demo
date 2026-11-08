import type { AiFault, DataFault, RiskResult } from "@/lib/riskChallenge";

export interface RiskSelection {
  aiFault: AiFault;
  dataFault: DataFault;
  orderId: string;
  siteName: string;
}

export interface RiskCheck {
  label: string;
  status: "Pass" | "Failed" | "Not evaluated";
  detail: string;
}

export interface RiskPresentation {
  headline: string;
  reason: string;
  checks: RiskCheck[];
  value?: { label: string; text: string; note: string };
  impact?: string;
  nextAction: string;
  fallback: string;
}

/** Presentation of the existing engine's evidence only; never schedules or validates a plan. */
export function presentRisk(result: RiskResult, selection: RiskSelection): RiskPresentation {
  if (result.kind === "overload") {
    // Read the engine's normalized values, not the editable controls or a second normalization rule.
    const values = result.input.match(/^(\d+) simulated parcels; demo capacity (\d+); demo time budget (\d+) ms$/);
    const checks: RiskCheck[] = values ? [
      { label: "Capacity check", status: Number(values[1]) > Number(values[2]) ? "Failed" : "Pass", detail: `${values[1]} parcels / ${values[2]} configured capacity` },
      { label: "Time-budget check", status: result.status === "timeout" ? "Failed" : "Pass", detail: `${Number(values[1]) * 10} ms simulated work / ${values[3]} ms budget` },
    ] : [
      { label: "Capacity check", status: "Not evaluated", detail: "See the original engine evidence below; summary values could not be read." },
      { label: "Time-budget check", status: "Not evaluated", detail: "See the original engine evidence below; summary values could not be read." },
    ];
    return {
      headline: result.status === "safe" ? "System within configured limits" : result.status === "timeout" ? "Processing time limit exceeded" : "Capacity exceeded — Review required",
      reason: result.status === "safe" ? "Both configured limits passed in this simulated test." : result.status === "timeout" ? "The simulated work exceeds the time budget. TIMEOUT takes priority, even when capacity also fails." : "The parcel count exceeds capacity; the time budget still passes.",
      checks,
      nextAction: result.status === "safe" ? "Save this result, then return to normal planning when ready." : "Reduce the test workload or review the configured limits, then retry. Review the full plan before any dispatch.",
      fallback: result.fallback,
    };
  }

  if (result.kind === "ai") {
    // The engine reports probabilities to three decimals. Display that same reported value as a percentage.
    const probability = result.detection.match(/(?:p_success=|Predicted )(\d+\.\d+)/);
    const valid = probability !== null;
    const inputRejected = /feature/i.test(result.detection) && !valid;
    const conflict = valid && result.status === "review";
    const headings: Record<AiFault, string> = {
      none: "AI prediction rejected — Validation required",
      nan: "AI prediction rejected — Invalid number",
      infinity: "AI prediction rejected — Infinite value",
      above_one: "AI prediction rejected — Out of range",
      missing_feature: "AI input rejected — Required data missing",
      hard_conflict: "AI suggestion blocked — Delivery window conflict",
    };
    const invalidDetails: Partial<Record<AiFault, string>> = {
      nan: "Injected NaN is not a usable number.",
      infinity: "Injected Infinity is not a finite probability.",
      above_one: "Injected 1.25 = 125%, outside the allowed 0%–100% range.",
    };
    const ruleDetail = conflict
      ? selection.aiFault === "hard_conflict"
        ? "The injected buyer commitment is simulated and conflicts with the proposed delivery block."
        : "The proposed block conflicts with a buyer commitment or a verified hard site rule."
      : valid ? "The tested block passes the existing buyer-window and hard site-rule checks." : "No usable prediction to assess for delivery. Do not treat this as a rules PASS.";
    return {
      headline: result.status === "safe" ? "AI prediction passed safety checks" : inputRejected ? "AI input rejected — Required data missing" : conflict ? headings.hard_conflict : headings[selection.aiFault],
      reason: valid ? conflict ? "The probability is mathematically valid, but the delivery suggestion cannot be used operationally." : "Numeric validation and the tested operational constraints both passed. Delivery success is not guaranteed." : inputRejected ? "A required model feature is missing or invalid. No usable probability was returned." : invalidDetails[selection.aiFault] ?? result.detection,
      checks: [
        { label: "AI output validation", status: valid ? "Pass" : inputRejected ? "Not evaluated" : "Failed", detail: valid ? "Finite probability within 0%–100%." : inputRejected ? "Input validation rejected a required feature before a probability was produced." : invalidDetails[selection.aiFault] ?? result.detection },
        { label: "Operational delivery rules", status: valid ? conflict ? "Failed" : "Pass" : "Not evaluated", detail: ruleDetail },
      ],
      value: valid ? { label: "Model probability · experimental", text: `${(Number(probability[1]) * 100).toFixed(1)}%`, note: "Logistic regression estimate, rounded as in the engine evidence. Not a guarantee of delivery success." }
        : selection.aiFault === "above_one" && !inputRejected ? { label: "Injected invalid output", text: "125%", note: "Fault fixture: 1.25. Rejected; this is not a valid model estimate." } : undefined,
      nextAction: result.status === "safe" ? "Compare Model and Rules drafts before deciding whether to dispatch." : "Review the rejection reason. Create a Rules draft if needed, then review it in Dispatcher; dispatch remains a separate action.",
      fallback: result.status === "safe" ? "No fallback needed for this test" : "Rules Planner available as a draft only; no automatic dispatch",
    };
  }

  const data: Record<DataFault, { headline: string; value: string; reason: string; impact: string; nextAction: string }> = {
    missing_pin: {
      headline: "Delivery location is missing", value: "Map pin: null",
      reason: "The isolated copy has no valid map pin for the selected order.",
      impact: "A rider could travel to the wrong entrance or be unable to locate the delivery.",
      nextAction: result.fallback === "Verified entrance" ? "A verified entrance point is available. Review its use as a fallback and flag the original pin for verification." : "Request location verification from the dispatcher or buyer. Hold the invalid location assignment until it is verified.",
    },
    duplicate_id: {
      headline: "Duplicate order ID detected", value: `Order ID ${selection.orderId} appears twice in the isolated copy`,
      reason: "The injected copy duplicates an existing order/attempt identifier.",
      impact: "An unchecked duplicate could lead to a repeated delivery or inflated parcel counts.",
      nextAction: "Retain the previously accepted record as the safe path. Review the duplicate ID and quarantine the extra copy through the data-review workflow if appropriate.",
    },
    negative_service: {
      headline: "Invalid delivery processing time", value: "Processing time: −5 minutes",
      reason: "A negative processing duration is invalid.",
      impact: "An invalid duration could understate route time and produce misleading ETAs.",
      nextAction: "Verify and correct the processing time, or have the dispatcher approve a documented fallback. Hold the invalid record pending review.",
    },
    invalid_window: {
      headline: "Delivery window is not recognized", value: 'Receiving window: "overnight"',
      reason: '"overnight" is not a supported receiving window; the existing blocks are morning, afternoon and evening.',
      impact: "An unrecognized window could schedule a delivery outside the buyer's agreed time.",
      nextAction: "Ask the buyer or dispatcher to verify the intended window. Hold the invalid window; do not silently replace a confirmed commitment.",
    },
    conflicting_card: {
      headline: "Conflicting delivery-site rules", value: "Morning-only versus evening-only",
      reason: "The two injected verified-window rules have no overlapping receiving block.",
      impact: "Following conflicting instructions could cause an arrival when the site cannot receive the parcel.",
      nextAction: "Preserve the accepted Stop Card. Review both conflicting edits and verify the site's receiving rules before approving any replacement.",
    },
  };
  const item = data[selection.dataFault];
  return {
    ...item,
    checks: [{ label: "Data validation", status: "Failed", detail: result.detection }],
    value: { label: "Injected data · isolated copy", text: item.value, note: "Source data was not edited. No quarantine, repair or approval was performed by this test." },
    fallback: selection.dataFault === "missing_pin" ? result.fallback === "Verified entrance" ? "Verified entrance point available for review; not applied" : "No verified entrance fallback available; dispatcher location review required"
      : selection.dataFault === "duplicate_id" ? "Previously accepted record remains unchanged; review the extra copy"
      : selection.dataFault === "conflicting_card" ? "Existing Stop Card remains unchanged; conflicting edits require review" : result.fallback,
  };
}
