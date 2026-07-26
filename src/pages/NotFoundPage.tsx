import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-16">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">404</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The page you requested does not exist or is no longer available.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Return home
        </Link>
      </div>
    </main>
  );
}
