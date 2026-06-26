import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock("sonner", () => ({
  toast: { success: (m: string) => mockToastSuccess(m), error: (m: string) => mockToastError(m) },
}));

// Capture the onSuccess / onError handlers so tests can invoke them directly.
let capturedOnSuccess: ((data: unknown) => void) | undefined;
let capturedOnError: ((error: unknown) => void) | undefined;
const mockMutate = jest.fn();
const mockMutateAsync = jest.fn();

jest.mock("@/lib/graphql/generated", () => ({
  useCreateBountyMutation: (options: {
    onSuccess: (data: unknown) => void;
    onError: (error: unknown) => void;
  }) => {
    capturedOnSuccess = options.onSuccess;
    capturedOnError = options.onError;
    return {
      mutate: mockMutate,
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      isSuccess: false,
    };
  },
}));

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => {
  const original = jest.requireActual("@tanstack/react-query");
  return {
    ...original,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

jest.mock("@/lib/query/query-keys", () => ({
  bountyKeys: { lists: () => ["Bounties"] },
}));

// ---------------------------------------------------------------------------
// Import subject under test (after mocks are in place)
// ---------------------------------------------------------------------------
import { useCreateBounty } from "../use-create-bounty";
import { BountyType } from "@/lib/graphql/generated";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const createWrapper = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
};

const MOCK_INPUT = {
  title: "Fix Soroban Bug",
  type: BountyType.FixedPrice,
  description: "Detailed description here.",
  organizationId: "org-1",
  githubIssueUrl: "https://github.com/org/repo/issues/1",
  rewardAmount: 500,
  rewardCurrency: "USDC",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useCreateBounty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnSuccess = undefined;
    capturedOnError = undefined;
  });

  it("exposes createBounty and createBountyAsync helpers", () => {
    const { result } = renderHook(() => useCreateBounty(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current.createBounty).toBe("function");
    expect(typeof result.current.createBountyAsync).toBe("function");
  });

  it("calls mutation.mutate with wrapped input on createBounty", () => {
    const { result } = renderHook(() => useCreateBounty(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.createBounty(MOCK_INPUT);
    });

    expect(mockMutate).toHaveBeenCalledWith({ input: MOCK_INPUT });
  });

  it("calls mutation.mutateAsync with wrapped input on createBountyAsync", () => {
    const { result } = renderHook(() => useCreateBounty(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.createBountyAsync(MOCK_INPUT);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({ input: MOCK_INPUT });
  });

  describe("onSuccess", () => {
    it("invalidates bounty list cache", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnSuccess?.({ createBounty: { id: "bounty-123" } });
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: ["Bounties"],
        });
      });
    });

    it("shows a success toast", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnSuccess?.({ createBounty: { id: "bounty-123" } });
      });

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          "Bounty created successfully!"
        );
      });
    });

    it("redirects to the new bounty detail page when id is present", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnSuccess?.({ createBounty: { id: "bounty-xyz" } });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/bounty/bounty-xyz");
      });
    });

    it("falls back to /bounty when id is missing", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnSuccess?.({ createBounty: null });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/bounty");
      });
    });
  });

  describe("onError", () => {
    it("shows the error message from an Error instance", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnError?.(new Error("Network failure"));
      });

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Network failure");
      });
    });

    it("shows a fallback message for non-Error rejections", async () => {
      renderHook(() => useCreateBounty(), { wrapper: createWrapper() });

      act(() => {
        capturedOnError?.("something went wrong");
      });

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Failed to create bounty");
      });
    });
  });
});
