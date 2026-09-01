import Link from "next/link";

type PageFrameProps = {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
};

export function PageFrame({
  eyebrow = "حياك — HAYYAK",
  title,
  description,
  children,
}: PageFrameProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-8">
      <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_24px_80px_rgb(25_42_34/0.08)] sm:p-10">
        <Link
          href="/"
          className="inline-flex rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold tracking-wide text-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
        >
          {eyebrow}
        </Link>
        <h1 className="mt-7 text-3xl leading-[1.5] font-bold text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-8 text-[var(--muted)] sm:text-base">
          {description}
        </p>
        {children ? <div className="mt-8">{children}</div> : null}
      </section>
    </main>
  );
}

