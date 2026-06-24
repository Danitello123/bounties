"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useUserRole } from "@/hooks/use-user-role";
import { BountyCreateForm } from "@/components/bounty/bounty-create-form";

interface ExtendedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  organizations?: string[];
}

export default function CreateBountyPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const userRole = useUserRole();

  const user = session?.user as ExtendedUser | undefined;
  const isSponsorOrOrgMember = user && (
    user.role === "sponsor" || 
    (user.organizations && user.organizations.length > 0)
  );

  useEffect(() => {
    // Redirect to /bounty if the user is not authorized as a sponsor or organization member
    if (!isPending && !isSponsorOrOrgMember) {
      router.push("/bounty");
    }
  }, [isSponsorOrOrgMember, isPending, router]);

  // Show nothing while checking auth or redirecting
  if (isPending || !isSponsorOrOrgMember) {
    return null;
  }

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-3xl font-extrabold tracking-tight mb-8">
        Bounty Creation Portal
      </h1>
      <BountyCreateForm />
    </div>
  );
}
