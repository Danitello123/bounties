"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCreateBountyMutation, type CreateBountyInput } from "@/lib/graphql/generated";
import { bountyKeys } from "@/lib/query/query-keys";

export function useCreateBounty() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const mutation = useCreateBountyMutation({
    onSuccess: (data) => {
      // Invalidate bounty lists to refresh lists and caches
      queryClient.invalidateQueries({ queryKey: bountyKeys.lists() });
      toast.success("Bounty created successfully!");
      
      const bountyId = data?.createBounty?.id;
      if (bountyId) {
        router.push(`/bounty/${bountyId}`);
      } else {
        router.push("/bounty");
      }
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Failed to create bounty";
      toast.error(message);
    },
  });

  return {
    ...mutation,
    createBounty: (input: CreateBountyInput) => {
      return mutation.mutate({ input });
    },
    createBountyAsync: (input: CreateBountyInput) => {
      return mutation.mutateAsync({ input });
    },
  };
}
