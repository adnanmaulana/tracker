"use client";

// Same motion language as the portfolio (adnan-personal/src/components/motion).

import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { formatNumber } from "@/lib/format";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Honors the OS "reduce motion" setting for every motion component. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/* Reveal: fade + rise + unblur when scrolled into view */
type RevealProps = HTMLMotionProps<"div"> & { delay?: number; y?: number };

export function Reveal({ delay = 0, y = 24, children, ...rest }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, delay, ease: EASE_OUT }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* Stagger: children animate one after another */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE_OUT } },
};

type StaggerProps = HTMLMotionProps<"div"> & { stagger?: number; delay?: number; as?: "div" | "ul" | "ol" };

export function Stagger({ stagger = 0.08, delay = 0, as = "div", children, ...rest }: StaggerProps) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -6% 0px" }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

type ItemProps = HTMLMotionProps<"div"> & { as?: "div" | "li" | "article" };

export function StaggerItem({ as = "div", children, variants, ...rest }: ItemProps) {
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp variants={variants ?? itemVariants} {...rest}>
      {children}
    </Comp>
  );
}

/* CountUp: animates to a number when in view, and between values when it changes */
export function CountUp({ to, duration = 1.2 }: { to: number; duration?: number }) {
  const format = formatNumber;
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(from.current, to, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setValue(Math.round(v)),
    });
    from.current = to;
    return () => controls.stop();
  }, [inView, reduce, to, duration]);

  return (
    <span ref={ref}>
      <span className="sr-only">{format(to)}</span>
      <span aria-hidden="true">{format(reduce ? to : value)}</span>
    </span>
  );
}

/* Typewriter: types a short label when in view (used for section eyebrows) */
export function Typewriter({ text, speed = 32 }: { text: string; speed?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setN(++i);
      if (i < text.length) timer = setTimeout(tick, speed + Math.random() * speed * 0.6);
    };
    timer = setTimeout(tick, speed);
    return () => clearTimeout(timer);
  }, [inView, reduce, text, speed]);

  return (
    <span ref={ref} className="relative inline-block">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="invisible">
        {text}
      </span>
      <span aria-hidden="true" className="absolute inset-0 whitespace-pre">
        {reduce ? text : text.slice(0, n)}
      </span>
    </span>
  );
}

/* Magnetic: element leans toward the pointer */
export function Magnetic({ children, strength = 0.25, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 250, damping: 18, mass: 0.4 });
  const y = useSpring(useMotionValue(0), { stiffness: 250, damping: 18, mass: 0.4 });

  return (
    <motion.span
      ref={ref}
      className={className ?? "inline-flex"}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
