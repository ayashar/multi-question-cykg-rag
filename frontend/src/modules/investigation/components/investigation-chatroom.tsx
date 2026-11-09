"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, FileText, LoaderCircle, Sparkles } from "lucide-react";
import { getChatTranscript, progressEventsFromTrace, type Case, type InvestigationProgressEvent, type TurnRecord } from "@/api";
import { ButtonLink } from "@/components/ui/button";
import { TurnResult } from "@/components/ui/error-states";
import InvestigationActivityLog from "@/components/ui/investigation-activity-log";
import MarkdownContent from "@/components/ui/markdown-content";
import {
  createChatroomCase,
  createInitialChatTurns,
  createMockFollowUpTurn,
} from "../data/chatroom-fixture";
import InvestigationReport from "./investigation-report";
import ConfidenceBadge from "./confidence-badge";
import {
  getAccountTranscript,
  getAccountTurnLogs,
  saveAccountTurn,
} from "@/lib/supabase/investigation-store";

function QuestionBubble({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto max-w-[calc(100%_-_24px)] rounded-[4px] border-r-3 border-neutral-900 bg-neutral-100 px-2.5 py-2.5 text-neutral-1000 sm:max-w-[calc(100%_-_160px)]">
      <p className="font-b1 wrap-anywhere">{children}</p>
    </div>
  );
}

function AnswerBubble({ turn }: { turn: TurnRecord }) {
  return (
    <article className="max-w-[calc(100%_-_24px)] space-y-3 rounded-[4px] border-l-3 border-black-600 bg-neutral-800 px-2.5 py-2.5 text-neutral-200 sm:max-w-[calc(100%_-_280px)]">
      <MarkdownContent value={turn.answer || "No narrative was returned for this response."} className="font-b1" />

      {turn.critical_analysis && (
        <section className="space-y-1 border-t border-neutral-700 pt-2">
          <h3 className="font-b3 font-semibold uppercase tracking-wide">Critical analysis</h3>
          <MarkdownContent value={turn.critical_analysis} className="font-b2" />
        </section>
      )}

      {turn.mitigation_suggestions.length > 0 && (
        <section className="space-y-1 border-t border-neutral-700 pt-2">
          <h3 className="font-b3 font-semibold uppercase tracking-wide">Suggested actions</h3>
          <ul className="list-disc space-y-1 pl-5 font-b2">
            {turn.mitigation_suggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}
          </ul>
        </section>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-neutral-700 pt-2 font-b3">
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Confidence</dt>
          <dd><ConfidenceBadge confidence={turn.confidence} /></dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Priority</dt>
          <dd className="font-semibold capitalize">{turn.recommended_priority ?? "Not provided"}</dd>
        </div>
      </dl>
    </article>
  );
}

function ChatActivity({ events }: { events: InvestigationProgressEvent[] }) {
  const latestAgent = [...events]
    .reverse()
    .find((event) => event.type === "agent" && event.status === "running");
  const completedAgents = events.filter((event) => event.type === "agent" && event.status === "complete");
  const latestLog = [...events].reverse().find((event) => event.type === "log" && event.message);

  return (
    <section
      aria-label="Live response activity"
      aria-live="polite"
      className="rounded-[6px] border border-primary-200 bg-background/45 p-3"
    >
      <div className="flex items-center gap-2">
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary-700" />
        <p className="font-b2 font-semibold">
          {latestAgent?.label ? `${latestAgent.label} is working…` : "Preparing response…"}
        </p>
        <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 font-b3 text-primary-800">Live</span>
      </div>

      {latestLog?.message ? (
        <p className="mt-2 border-l-2 border-primary-300 pl-2 font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">
          {latestLog.message}
        </p>
      ) : completedAgents.length > 0 ? (
        <p className="mt-2 font-b3 text-primary-800">{completedAgents.length} processing step{completedAgents.length === 1 ? "" : "s"} completed.</p>
      ) : (
        <p className="mt-2 font-b3 text-primary-800">Waiting for the investigation service to report progress.</p>
      )}

      <InvestigationActivityLog events={events} defaultOpen />
    </section>
  );
}

function InvestigationUnavailable() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-[4px] bg-primary-100 p-6 text-center">
      <div className="max-w-md">
        <h3 className="font-h7">Investigation not started</h3>
        <p className="mt-1 font-b2 text-primary-900">Start an investigation for this case before asking follow-up questions.</p>
        <ButtonLink href="/cases" variant="primary" className="mt-4 font-b2">Back to Cases</ButtonLink>
      </div>
    </div>
  );
}

function getSummaryText(turn: TurnRecord): string | null {
  const source = turn.critical_analysis || turn.answer;
  if (!source) return null;

  const plainText = source
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plainText) return null;
  return plainText.length > 360 ? `${plainText.slice(0, 357).trimEnd()}…` : plainText;
}

function ChatAiSummary({ turn }: { turn: TurnRecord }) {
  const summary = getSummaryText(turn);
  if (!summary || turn.error) return null;

  return (
    <section aria-labelledby="chat-ai-summary" className="rounded-[8px] border border-primary-200 bg-background px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <h2 id="chat-ai-summary" className="font-b1 font-semibold">AI summary</h2>
        {turn.confidence && <ConfidenceBadge confidence={turn.confidence} />}
      </div>
      <p className="mt-2 font-b2 leading-relaxed text-neutral-900">{summary}</p>
      <p className="mt-2 font-b3 text-neutral-700">Based on the initial investigation. Open the report below for the full findings and evidence.</p>
    </section>
  );
}

function mergeTranscriptTurn(current: TurnRecord, incoming: TurnRecord): TurnRecord {
  // A just-completed request can reach the UI before the persisted transcript.
  // Do not replace that successful result with an older failed/incomplete record.
  if (current.answer && !incoming.answer && incoming.error) return current;
  if (current.error && !incoming.error) return incoming;
  return incoming;
}

export default function InvestigationChatroom({
  caseId = "case-1234-5678",
  hasInvestigation = true,
  value: providedValue,
  initialTurns,
  initialEvents,
  onSendQuestion,
}: {
  caseId?: string;
  hasInvestigation?: boolean;
  value?: Case;
  initialTurns?: TurnRecord[];
  initialEvents?: InvestigationProgressEvent[];
  onSendQuestion?: (question: string, onProgress: (event: InvestigationProgressEvent) => void) => Promise<TurnRecord>;
}) {
  const investigationReady = hasInvestigation;
  const value = useMemo(() => providedValue ?? createChatroomCase(caseId), [caseId, providedValue]);
  const [turns, setTurns] = useState(() => initialTurns ?? createInitialChatTurns(caseId));
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatEvents, setChatEvents] = useState<InvestigationProgressEvent[]>([]);
  const [chatLogs, setChatLogs] = useState<Record<number, InvestigationProgressEvent[]>>({});
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEventsRef = useRef<InvestigationProgressEvent[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    if (!investigationReady) return;
    let cancelled = false;
    void Promise.all([
      getAccountTranscript(caseId).catch(() => []),
      getAccountTurnLogs(caseId).catch(() => ({})),
    ]).then(async ([accountTranscript, accountLogs]) => {
      const transcript = accountTranscript.length
        ? accountTranscript
        : await getChatTranscript(caseId, true).catch(() => []);
      if (cancelled || !transcript.length) return;
      const traceLogs = Object.fromEntries(
        transcript
          .filter((turn) => turn.trace?.log?.length)
          .map((turn) => [turn.turn_index, progressEventsFromTrace(turn)]),
      );
      const restoredLogs = { ...traceLogs, ...accountLogs };
      setChatLogs((current) => ({ ...restoredLogs, ...current }));
      setTurns((current) => {
        const merged = new Map(current.map((turn) => [turn.turn_index, turn]));
        transcript.forEach((turn) => {
          const existing = merged.get(turn.turn_index);
          merged.set(turn.turn_index, existing ? mergeTranscriptTurn(existing, turn) : turn);
        });
        return [...merged.values()];
      });
    }).catch(() => {
      // Keep the initial turn visible when transcript loading is unavailable.
    });
    return () => { cancelled = true; };
  }, [caseId, investigationReady]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isSending, pendingQuestion, turns]);

  const orderedTurns = useMemo(
    () => [...turns].sort((left, right) => left.turn_index - right.turn_index),
    [turns],
  );
  const firstTurn = orderedTurns.find((turn) => turn.turn_index === 1);
  const summaryTurn = initialTurns?.find((turn) => !turn.error && (turn.answer || turn.critical_analysis))
    ?? orderedTurns.find((turn) => !turn.error && (turn.answer || turn.critical_analysis));
  const firstTurnEvents = firstTurn?.trace ? progressEventsFromTrace(firstTurn) : initialEvents ?? [];
  const followUps = orderedTurns.filter((turn) => turn.turn_index > 1);

  const sendQuestion = async (questionInput = draft) => {
    const question = questionInput.trim();
    if (!question || isSending || !investigationReady) return;

    const nextIndex = Math.max(1, ...turns.map((turn) => turn.turn_index)) + 1;
    setDraft("");
    setIsSending(true);
    setPendingQuestion(question);
    setChatEvents([]);
    chatEventsRef.current = [];
    setSendError(null);

    const onProgress = (event: InvestigationProgressEvent) => {
      chatEventsRef.current = [...chatEventsRef.current, event];
      setChatEvents(chatEventsRef.current);
    };

    try {
      const response = onSendQuestion
        ? await onSendQuestion(question, onProgress)
        : await new Promise<TurnRecord>((resolve) => {
            timeoutRef.current = setTimeout(() => resolve(createMockFollowUpTurn(caseId, nextIndex, question)), 900);
          });
      setTurns((current) => [...current, response]);
      setChatLogs((current) => ({ ...current, [response.turn_index]: chatEventsRef.current }));
      void saveAccountTurn(caseId, response, chatEventsRef.current).catch((reason) => {
        console.warn("Failed to save chat turn to Supabase:", reason);
      });
    } catch {
      setSendError("The follow-up response could not be loaded. Try again.");
    } finally {
      setPendingQuestion(null);
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-5 text-black-600">
      {investigationReady && <div>
        <h2 className="font-h7">Ask about this case</h2>
        <p className="font-b1">Ask anything you don’t understand. Let the power of AI explain.</p>
      </div>}

      <section aria-label="Investigation chat transcript" className="flex min-h-[465px] flex-col gap-5 rounded-[10px] bg-primary-300 p-5">
        {!investigationReady ? (
          <InvestigationUnavailable />
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {summaryTurn && <ChatAiSummary turn={summaryTurn} />}
              {firstTurn && (
                <details className="group rounded-[8px] bg-background">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                      <FileText aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-b1 font-semibold">Initial investigation report</span>
                      <span className="block font-b3 text-neutral-800">Turn 1 · View the full report used to start this conversation</span>
                    </span>
                    <ChevronDown aria-hidden="true" className="size-5 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-neutral-300 p-4">
                    <InvestigationReport value={value} turn={firstTurn} />
                    <InvestigationActivityLog events={firstTurnEvents} trace={firstTurn.trace} />
                  </div>
                </details>
              )}
              {followUps.map((turn) => (
                <div key={`${turn.turn_index}:${turn.timestamp}`} className="space-y-3">
                  <QuestionBubble>{turn.question}</QuestionBubble>
                  <TurnResult turn={turn} onRetry={() => void sendQuestion(turn.question)}>
                    <AnswerBubble turn={turn} />
                  </TurnResult>
                  <InvestigationActivityLog events={chatLogs[turn.turn_index] ?? []} trace={turn.trace} />
                </div>
              ))}
              {isSending && (
                <div className="space-y-3">
                  {pendingQuestion && <QuestionBubble>{pendingQuestion}</QuestionBubble>}
                  <ChatActivity events={chatEvents} />
                </div>
              )}
              {sendError && <p role="alert" className="font-b2 text-red-500">{sendError}</p>}
              {!isSending && sendError && <InvestigationActivityLog events={chatEvents} defaultOpen />}
              <div ref={transcriptEndRef} aria-hidden="true" />
            </div>

            <hr className="border-neutral-900" />

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendQuestion();
              }}
              className="flex items-start gap-2 rounded-[8px] bg-neutral-100 p-2.5"
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={isSending}
                rows={3}
                placeholder="Ask another question..."
                aria-label="Ask another question"
                className="min-h-[62px] flex-1 resize-none bg-transparent px-0.5 py-0.5 font-b1 text-neutral-900 outline-none placeholder:text-neutral-900/80 disabled:cursor-wait"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isSending}
                aria-label="Send question"
                className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp aria-hidden="true" className="size-5" />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
