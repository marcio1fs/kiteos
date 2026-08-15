'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center space-y-4 bg-background text-foreground">
          <h2 className="text-2xl font-bold tracking-tight">Erro fatal do sistema</h2>
          <p className="text-muted-foreground">
            Ocorreu um erro crítico. Por favor, recarregue a página.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Recarregar página
          </button>
        </div>
      </body>
    </html>
  );
}
