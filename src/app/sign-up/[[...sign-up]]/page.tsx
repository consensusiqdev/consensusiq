import { SignUp } from "@clerk/nextjs";
import { redirectIfSignedIn } from "@/lib/subscription";

// Needs the visitor's live Clerk session on every request to decide whether to redirect away —
// can never produce a static shell, so opt out of instant-shell validation.
export const instant = false;

export default async function SignUpPage() {
  await redirectIfSignedIn();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-16">
      <SignUp />
    </main>
  );
}
