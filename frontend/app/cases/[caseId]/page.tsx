import CaseInvestigation from "@/modules/investigation/components/case-investigation";
import { parseLookbackHours } from "@/modules/investigation/services/investigation-service";

export default async function InvestigationPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{
    lookback_hours?: string | string[];
    view?: string | string[];
    chat_state?: string | string[];
    reopen?: string | string[];
  }>;
}) {
  const [{ caseId }, query] = await Promise.all([params, searchParams]);
  const lookbackHours = parseLookbackHours(query.lookback_hours);
  const initialView = query.view === "graph" || query.view === "report" || query.view === "chat" ? query.view : "details";
  return (
    <CaseInvestigation
      key={`${caseId}:${lookbackHours}`}
      caseId={caseId}
      lookbackHours={lookbackHours}
      initialView={initialView}
      reopenSaved={query.reopen === "1"}
      chatUnavailable={initialView === "chat" && query.chat_state === "not-started"}
    />
  );
}
