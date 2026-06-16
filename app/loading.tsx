import Image from "next/image";

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <section className="text-center">
        <Image
          src="/unloan-logo.svg"
          alt="UNLOAN"
          width={220}
          height={74}
          priority
          className="mx-auto"
        />
        <h1 className="mt-6 text-3xl font-semibold tracking-normal text-[#0D47A1]">
          UNLOAN
        </h1>
        <p className="mt-3 text-sm font-medium leading-6 text-[#1E88E5]">
          Build Wealth.
          <br />
          Reduce Debt.
          <br />
          Create Freedom.
        </p>
      </section>
    </main>
  );
}
