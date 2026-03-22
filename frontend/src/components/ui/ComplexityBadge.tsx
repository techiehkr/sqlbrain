import clsx from 'clsx'

interface Props {
  score: number
  level: string
}

export default function ComplexityBadge({ score, level }: Props) {
  return (
    <span className={clsx(
      "px-2 py-0.5 rounded-full text-[10px] font-medium border",
      level === 'High' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
      level === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
      'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
    )}>
      {level} · {score}/10
    </span>
  )
}
