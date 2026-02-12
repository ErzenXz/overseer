import Link from "next/link";
import { notFound } from "next/navigation";
import { providersModel } from "@/database";
import { EditProviderForm } from "./EditProviderForm";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditProviderPage({ params }: PageProps) {
  const { id } = await params;
  const providerId = Number.parseInt(id, 10);

  if (!Number.isFinite(providerId)) {
    notFound();
  }

  const provider = providersModel.findById(providerId);
  if (!provider) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Edit Provider</h1>
          <p className="text-text-secondary mt-1">
            Update provider settings, model selection, and reasoning options.
          </p>
        </div>
        <Link
          href="/providers"
          className="px-3 py-2 rounded border border-border text-text-secondary hover:text-white"
        >
          Back
        </Link>
      </div>

      <EditProviderForm provider={provider} />
    </div>
  );
}
