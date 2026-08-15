import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-4">
      <h2 className="text-3xl font-bold tracking-tight text-foreground">Página não encontrada</h2>
      <p className="text-muted-foreground">
        Não conseguimos encontrar a página que você está procurando.
      </p>
      <Link
        href="/"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors inline-block"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
