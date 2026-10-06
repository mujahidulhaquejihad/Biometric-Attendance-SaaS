"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6">
      <h2 className="font-semibold text-red-800">Something went wrong</h2>
      <p className="mt-2 text-sm text-red-700">{error.message || "Unexpected error."}</p>
      <button onClick={reset} className="mt-4 rounded-md bg-red-600 px-3 py-2 text-sm text-white">Try again</button>
    </div>
  );
}
