"use client";

import type { InvestigationProgressEvent, TimeRangeRequest, TurnRecord } from "@/api/client";
import type { InvestigatedCaseRecord } from "@/modules/cases/types";
import { createClient } from "@/lib/supabase/client";

export const ACTIVE_ACCOUNT_STORAGE_KEY = "cskg_active_account_id";
export const ACCOUNT_HISTORY_STORAGE_PREFIX = "cskg_investigated_cases_v3";
export const ACCOUNT_HISTORY_EVENT = "cskg-investigation-history-change";

interface InvestigationRow {
  id: string;
  case_id: string;
  lookback_hours: number | null;
  source: InvestigatedCaseRecord["source"];
  case_snapshot: InvestigatedCaseRecord["case"];
  progress_events: InvestigationProgressEvent[] | null;
  time_range: TimeRangeRequest | null;
  created_at: string;
  updated_at: string;
  investigation_turns?: Array<{
    turn_index: number;
    payload: TurnRecord;
    progress_events: InvestigationProgressEvent[] | null;
  }>;
}

function historyKey(userId: string) {
  return `${ACCOUNT_HISTORY_STORAGE_PREFIX}:${userId}`;
}

export function getActiveAccountId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveAccountId(userId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, userId);
}

export function clearActiveAccountId() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
  window.dispatchEvent(new Event(ACCOUNT_HISTORY_EVENT));
}

export function readCachedAccountHistory(): InvestigatedCaseRecord[] {
  const userId = getActiveAccountId();
  if (!userId || typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed as InvestigatedCaseRecord[] : [];
  } catch {
    return [];
  }
}

export function writeCachedAccountHistory(records: InvestigatedCaseRecord[]) {
  const userId = getActiveAccountId();
  if (!userId || typeof window === "undefined") return;
  localStorage.setItem(historyKey(userId), JSON.stringify(records.slice(0, 100)));
  window.dispatchEvent(new Event(ACCOUNT_HISTORY_EVENT));
}

async function authenticatedClient() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("No authenticated Supabase user.");
  setActiveAccountId(data.user.id);
  return { supabase, userId: data.user.id };
}

function rowToRecord(row: InvestigationRow): InvestigatedCaseRecord {
  const turns = [...(row.investigation_turns ?? [])].sort(
    (left, right) => left.turn_index - right.turn_index,
  );
  const initialTurn = turns.find((item) => item.turn_index === 1) ?? turns[0];
  return {
    case_id: row.case_id,
    investigated_at: row.updated_at ?? row.created_at,
    case: row.case_snapshot,
    turn: initialTurn?.payload,
    progress_events: initialTurn?.progress_events?.length
      ? initialTurn.progress_events
      : row.progress_events ?? undefined,
    lookback_hours: row.lookback_hours ?? undefined,
    source: row.source ?? "case-list",
    time_range: row.time_range ?? undefined,
  };
}

export async function syncAccountInvestigations(): Promise<InvestigatedCaseRecord[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .from("investigations")
    .select("id, case_id, lookback_hours, source, case_snapshot, progress_events, time_range, created_at, updated_at, investigation_turns(turn_index, payload, progress_events)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const records = ((data ?? []) as unknown as InvestigationRow[]).map(rowToRecord);
  writeCachedAccountHistory(records);
  return records;
}

export async function saveAccountInvestigation(
  record: InvestigatedCaseRecord,
  timeRange?: TimeRangeRequest,
): Promise<void> {
  const { supabase, userId } = await authenticatedClient();
  const status = record.turn?.error ? "failed" : record.turn ? "completed" : "running";
  const { data: investigation, error: investigationError } = await supabase
    .from("investigations")
    .upsert({
      user_id: userId,
      case_id: record.case_id,
      lookback_hours: record.lookback_hours ?? null,
      source: record.source ?? "case-list",
      status,
      case_snapshot: record.case,
      progress_events: record.progress_events ?? [],
      time_range: timeRange ?? record.time_range ?? null,
    }, { onConflict: "user_id,case_id" })
    .select("id")
    .single();
  if (investigationError) throw investigationError;

  if (record.turn) {
    const { error: turnError } = await supabase
      .from("investigation_turns")
      .upsert({
        investigation_id: investigation.id,
        user_id: userId,
        case_id: record.case_id,
        turn_index: record.turn.turn_index,
        payload: record.turn,
        progress_events: record.progress_events ?? [],
      }, { onConflict: "user_id,case_id,turn_index" });
    if (turnError) throw turnError;
  }
}

export async function saveAccountTurn(
  caseId: string,
  turn: TurnRecord,
  progressEvents: InvestigationProgressEvent[] = [],
): Promise<void> {
  const { supabase, userId } = await authenticatedClient();
  const { data: investigation, error: investigationError } = await supabase
    .from("investigations")
    .select("id")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .single();
  if (investigationError) throw investigationError;

  const { error } = await supabase.from("investigation_turns").upsert({
    investigation_id: investigation.id,
    user_id: userId,
    case_id: caseId,
    turn_index: turn.turn_index,
    payload: turn,
    progress_events: progressEvents,
  }, { onConflict: "user_id,case_id,turn_index" });
  if (error) throw error;
}

export async function getAccountTranscript(caseId: string): Promise<TurnRecord[]> {
  const { supabase, userId } = await authenticatedClient();
  const { data, error } = await supabase
    .from("investigation_turns")
    .select("turn_index, payload")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .order("turn_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.payload as TurnRecord);
}

export async function getAccountTurnLogs(
  caseId: string,
): Promise<Record<number, InvestigationProgressEvent[]>> {
  const { supabase, userId } = await authenticatedClient();
  const { data, error } = await supabase
    .from("investigation_turns")
    .select("turn_index, progress_events")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .order("turn_index", { ascending: true });
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((row) => [
      row.turn_index as number,
      (row.progress_events ?? []) as InvestigationProgressEvent[],
    ]),
  );
}
