'use client';

import { Star } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '../lib/cn.js';

/** The star that pops in when someone reaches a new level (~350ms, still under reduced motion). */
export function LevelUpMark({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={cn(
        'mx-auto grid size-24 place-items-center rounded-full bg-accent-soft text-accent-ink [&_svg]:size-12',
        className,
      )}
      initial={reduceMotion ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
    >
      <Star className="fill-accent" />
    </motion.div>
  );
}
