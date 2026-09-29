"use client";

interface MitreBadgesProps {
  techniques: string[];
  maxVisible?: number;
}

export default function MitreBadges({ techniques, maxVisible = 4 }: MitreBadgesProps) {
  if (!techniques || techniques.length === 0) {
    return <span className="text-xs text-neutral-700 italic">None</span>;
  }

  const visibleTechniques = techniques.slice(0, maxVisible);
  const remainingCount = techniques.length - maxVisible;

  return (
    <div className="flex w-fit max-w-full flex-wrap gap-1">
      {visibleTechniques.map((tech) => {
        const urlPath = tech.includes(".") ? tech.replace(".", "/") : tech;
        const mitreUrl = `https://attack.mitre.org/techniques/${urlPath}/`;

        return (
          <a
            key={tech}
            href={mitreUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`View ${tech} on MITRE ATT&CK`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex w-fit max-w-full items-center justify-center whitespace-nowrap px-2 py-0.5 rounded-[3px] bg-[#4a3b59] hover:bg-[#392d45] text-white font-mono text-[10px] font-medium transition-colors cursor-pointer text-center"
          >
            {tech}
          </a>
        );
      })}

      {remainingCount > 0 && (
        <span
          className="inline-flex w-fit items-center justify-center whitespace-nowrap px-1.5 py-0.5 rounded-[3px] bg-[#392d45]/70 text-white/90 font-mono text-[10px] font-medium text-center"
          title={techniques.slice(maxVisible).join(", ")}
        >
          +{remainingCount}
        </span>
      )}
    </div>
  );
}
