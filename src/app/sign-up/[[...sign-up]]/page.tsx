import { SignUp } from "@clerk/nextjs";
import { redirectIfSignedIn } from "@/lib/subscription";

export default async function SignUpPage() {
  await redirectIfSignedIn();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6 py-16">
      <SignUp />
    </main>
  );
}
