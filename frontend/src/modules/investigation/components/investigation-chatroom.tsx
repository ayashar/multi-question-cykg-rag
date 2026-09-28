"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, FileText, LoaderCircle } from "lucide-react";
import type { Case, TurnRecord } from "@/api";
import { ButtonLink } from "@/components/ui/button";
import { TurnResult } from "@/components/ui/error-states";
import {
  createChatroomCase,
  createInitialChatTurns,
  createMockFollowUpTurn,
} from "../data/chatroom-fixture";
import InvestigationReport from "./investigation-report";

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
      <p className="font-b1 whitespace-pre-wrap wrap-anywhere">
        {turn.answer || "No narrative was returned for this response."}
      </p>

      {turn.critical_analysis && (
        <section className="space-y-1 border-t border-neutral-700 pt-2">
          <h3 className="font-b3 font-semibold uppercase tracking-wide">Critical analysis</h3>
          <p className="font-b2 whitespace-pre-wrap wrap-anywhere">{turn.critical_analysis}</p>
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
          <dd className="font-semibold capitalize">{turn.confidence ?? "Not provided"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-neutral-400">Priority</dt>
          <dd className="font-semibold capitalize">{turn.recommended_priority ?? "Not provided"}</dd>
        </div>
      </dl>
    </article>
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

export default function InvestigationChatroom({
  caseId = "case-1234-5678",
  hasInvestigation = true,
  value: providedValue,
  initialTurns,
  onSendQuestion,
}: {
  caseId?: string;
  hasInvestigation?: boolean;
  value?: Case;
  initialTurns?: TurnRecord[];
  onSendQuestion?: (question: string) => Promise<TurnRecord>;
}) {
  const investigationReady = hasInvestigation;
  const value = useMemo(() => providedValue ?? createChatroomCase(caseId), [caseId, providedValue]);
  const [turns, setTurns] = useState(() => initialTurns ?? createInitialChatTurns(caseId));
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isSending, pendingQuestion, turns]);

  const orderedTurns = useMemo(
    () => [...turns].sort((left, right) => left.turn_index - right.turn_index),
    [turns],
  );
  const firstTurn = orderedTurns.find((turn) => turn.turn_index === 1);
  const followUps = orderedTurns.filter((turn) => turn.turn_index > 1);

  const sendQuestion = async (questionInput = draft) => {
    const question = questionInput.trim();
    if (!question || isSending || !investigationReady) return;

    const nextIndex = Math.max(1, ...turns.map((turn) => turn.turn_index)) + 1;
    setDraft("");
    setIsSending(true);
    setPendingQuestion(question);
    setSendError(null);

    try {
      const response = onSendQuestion
        ? await onSendQuestion(question)
        : await new Promise<TurnRecord>((resolve) => {
            timeoutRef.current = setTimeout(() => resolve(createMockFollowUpTurn(caseId, nextIndex, question)), 900);
          });
      setTurns((current) => [...current, response]);
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
                  </div>
                </details>
              )}
              {followUps.map((turn) => (
                <div key={`${turn.turn_index}:${turn.timestamp}`} className="space-y-3">
                  <QuestionBubble>{turn.question}</QuestionBubble>
                  <TurnResult turn={turn} onRetry={() => void sendQuestion(turn.question)}>
                    <AnswerBubble turn={turn} />
                  </TurnResult>
                </div>
              ))}
              {isSending && (
                <div className="space-y-3">
                  {pendingQuestion && <QuestionBubble>{pendingQuestion}</QuestionBubble>}
                  <div role="status" className="flex items-center gap-2 text-neutral-800">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    <span className="font-b2">Preparing response… Usually takes 5–20 seconds.</span>
                  </div>
                </div>
              )}
              {sendError && <p role="alert" className="font-b2 text-red-500">{sendError}</p>}
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
