import InvestigationReportScreen from "@/modules/investigations/components/InvestigationReportScreen";

export default async function InvestigationReportPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <InvestigationReportScreen caseId={caseId} />;
}
