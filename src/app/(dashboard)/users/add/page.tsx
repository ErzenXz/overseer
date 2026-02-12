import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { usersModel } from "@/database";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const validRoles = new Set(["admin", "developer", "operator", "viewer"]);

async function createUserAction(formData: FormData) {
  "use server";

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "viewer").trim().toLowerCase();

  if (username.length < 3) {
    redirect("/users/add?error=Username%20must%20be%20at%20least%203%20characters");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    redirect("/users/add?error=Username%20can%20only%20contain%20letters%2C%20numbers%2C%20dot%2C%20underscore%2C%20or%20dash");
  }

  if (password.length < 8) {
    redirect("/users/add?error=Password%20must%20be%20at%20least%208%20characters");
  }

  if (!validRoles.has(role)) {
    redirect("/users/add?error=Invalid%20role%20selected");
  }

  const existing = usersModel.findByUsername(username);
  if (existing) {
    redirect("/users/add?error=Username%20already%20exists");
  }

  await usersModel.create(
    username,
    password,
    role as "admin" | "developer" | "operator" | "viewer"
  );

  revalidatePath("/users");
  redirect("/users/add?success=User%20created%20successfully");
}

export default async function AddUserPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const success = typeof params.success === "string" ? params.success : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Add User</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Create a new dashboard account with role-based access.
          </p>
        </div>
        <Link
          href="/users"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back to users
        </Link>
      </div>

      <div className="max-w-2xl bg-surface-raised border border-border rounded-lg p-6">
        <form action={createUserAction} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-white mb-2">
              Username
            </label>
            <input
              id="username"
              name="username"
              required
              minLength={3}
              placeholder="e.g. erzen.admin"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
              Temporary password
            </label>
            <input
              id="password"
              name="password"
              required
              minLength={8}
              type="password"
              placeholder="At least 8 characters"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="role" className="block text-sm font-medium text-white mb-2">
              Role
            </label>
            <select
              id="role"
              name="role"
              defaultValue="viewer"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="admin">Admin</option>
              <option value="developer">Developer</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          {error ? (
            <p className="text-sm text-red-400 text-pretty">{error}</p>
          ) : null}
          {success ? (
            <p className="text-sm text-green-400 text-pretty">{success}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
            >
              Create user
            </button>
            <p className="text-xs text-text-muted text-pretty">
              User can change password after first sign-in.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
