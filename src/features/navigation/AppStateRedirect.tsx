import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getLocalDatabase } from "@/db/client";

type Destination = "/app/setup" | "/app/recall";

export function AppStateRedirect() {
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const database = await getLocalDatabase();
      const repoCount = database.getRepoCount();
      const embeddingCount = database.getEmbeddingCount();
      const nextDestination: Destination = repoCount === 0 || embeddingCount === 0 ? "/app/setup" : "/app/recall";
      if (!cancelled) {
        setDestination(nextDestination);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!destination) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Preparing workspace...
      </div>
    );
  }

  return <Navigate to={destination} replace />;
}
