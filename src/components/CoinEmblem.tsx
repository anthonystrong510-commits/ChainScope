import { Cat, Crown, Dog, Flame, Gem, Ghost, Rocket, Zap } from 'lucide-react';
import type { EmblemIconName } from '../types/launchpad';

interface CoinEmblemProps {
  icon: EmblemIconName;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CoinEmblem({ icon, color, size = 'md' }: CoinEmblemProps) {
  const boxSize =
    size === 'sm' ? 'w-8 h-8 rounded-lg' : size === 'lg' ? 'w-12 h-12 rounded-xl' : 'w-10 h-10 rounded-xl';
  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  const IconComp = {
    rocket: Rocket,
    flame: Flame,
    zap: Zap,
    crown: Crown,
    gem: Gem,
    ghost: Ghost,
    cat: Cat,
    dog: Dog,
  }[icon] || Rocket;

  return (
    <div
      className={`${boxSize} flex items-center justify-center shrink-0 border`}
      style={{
        backgroundColor: `${color}1A`,
        borderColor: `${color}4D`,
        color,
      }}
      aria-hidden="true"
    >
      <IconComp className={iconSize} />
    </div>
  );
}
