import CaseInvestigation from "@/modules/investigation/components/case-investigation";
import { parseLookbackHours } from "@/modules/investigation/services/investigation-service";

export default async function InvestigationPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ lookback_hours?: string | string[] }>;
}) {
  const [{ caseId }, query] = await Promise.all([params, searchParams]);
  const lookbackHours = parseLookbackHours(query.lookback_hours);
  return <CaseInvestigation key={`${caseId}:${lookbackHours}`} caseId={caseId} lookbackHours={lookbackHours} />;
}
