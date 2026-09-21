import TimeRangeForm from "@/modules/investigation/components/time-range-form";

export default function TimeSpanPage() {
  return (
    <section className="w-full space-y-4 pb-16">
      <div>
        <p className="font-b3 font-semibold uppercase tracking-wider text-neutral-700">
          Manual Investigation
        </p>
        <h1 className="mt-1 font-h4 font-bold tracking-tight text-neutral-1000">
          Choose a time range.
        </h1>
        <p className="font-b2 text-neutral-800">
          Start an investigation without selecting a case from the queue.
        </p>
      </div>

      <TimeRangeForm />
    </section>
  );
}
