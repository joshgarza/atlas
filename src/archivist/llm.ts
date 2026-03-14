import {
  getReasoningProvider,
  type CandidateNode,
  type EventAnalysisInput,
  type LlmConsolidationResult,
} from '../model-providers.js';

export type { CandidateNode, LlmConsolidationResult } from '../model-providers.js';

/** Check if archivist reasoning is available for the configured provider. */
export function isLlmAvailable(): boolean {
  return getReasoningProvider().isAvailable();
}

/** Analyze an event using the configured reasoning provider. */
export async function analyzeEvent(
  event: EventAnalysisInput,
  candidates: CandidateNode[],
): Promise<LlmConsolidationResult> {
  return getReasoningProvider().analyzeEvent(event, candidates);
}
