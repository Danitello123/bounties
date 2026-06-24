"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { 
  CalendarIcon, 
  ArrowRight, 
  ArrowLeft, 
  Check, 
  Sparkles, 
  Github, 
  HelpCircle, 
  CheckCircle2, 
  Loader2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { useCreateBounty } from "@/hooks/use-create-bounty";
import { useLightningRounds, getRoundPhase } from "@/hooks/use-lightning-rounds";
import { mockProjects } from "@/lib/mock/projects";
import { BountyType } from "@/lib/graphql/generated";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  BudgetInput, 
  DeadlineInput, 
  MarkdownTextarea, 
  MilestoneBuilder 
} from "@/components/bounty/forms";

interface ExtendedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  organizations?: string[];
}

// Zod Schema for the Form
const bountyCreateSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title is too long"),
  type: z.nativeEnum(BountyType, { 
    required_error: "Please select a bounty type" 
  }),
  organizationId: z.string().min(1, "Organization is required"),
  projectId: z.string().optional(),
  githubIssueUrl: z.string().optional(),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(10000, "Description is too long"),
  reward: z.object({
    amount: z
      .number({ required_error: "Amount is required" })
      .positive("Amount must be greater than 0")
      .max(1000000, "Amount must be less than 1,000,000"),
    asset: z.string().min(1, "Please select an asset"),
  }),
  deadline: z.date().optional(),
  bountyWindowId: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  milestones: z
    .array(
      z.object({
        title: z.string().min(1, "Milestone title is required").max(100),
        description: z.string().optional(),
        percentage: z
          .number({ required_error: "% is required" })
          .min(1, "Min percentage is 1%")
          .max(100, "Max percentage is 100%"),
      })
    )
    .optional(),
}).superRefine((data, ctx) => {
  // FIXED_PRICE checks
  if (data.type === BountyType.FixedPrice) {
    if (!data.githubIssueUrl || !data.githubIssueUrl.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubIssueUrl"],
        message: "GitHub issue URL is required for Fixed Price bounties",
      });
    } else if (!data.githubIssueUrl.includes("github.com")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubIssueUrl"],
        message: "Must be a valid GitHub URL",
      });
    }

    if (!data.deadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadline"],
        message: "Deadline is required for Fixed Price bounties",
      });
    }
  }

  // General deadline validation
  if (data.deadline && data.deadline <= new Date()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deadline"],
      message: "Deadline must be in the future",
    });
  }

  // COMPETITION checks
  if (data.type === BountyType.Competition) {
    if (!data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startDate"],
        message: "Start date is required for Competitions",
      });
    }
    if (!data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date is required for Competitions",
      });
    } else if (data.startDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be after start date",
      });
    }
  }

  // MILESTONE_BASED checks
  if (data.type === BountyType.MilestoneBased) {
    if (!data.deadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadline"],
        message: "Deadline is required for Milestone-based bounties",
      });
    }

    if (!data.milestones || data.milestones.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["milestones"],
        message: "At least 2 milestones are required",
      });
    } else {
      const sum = data.milestones.reduce((acc, m) => acc + (m.percentage || 0), 0);
      if (sum !== 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones"],
          message: `Milestone percentages must sum to exactly 100% (currently ${sum}%)`,
        });
      }
    }
  }
});

type BountyFormValues = z.infer<typeof bountyCreateSchema>;

export function BountyCreateForm() {
  const [step, setStep] = useState(1);
  const { data: session } = authClient.useSession();
  const { createBounty, isPending: isSubmitting } = useCreateBounty();
  const { rounds } = useLightningRounds();

  // Parse user organizations & fallbacks
  const user = session?.user as ExtendedUser | undefined;
  const userOrgs = user?.organizations || [];
  const organizations = userOrgs.length > 0 
    ? userOrgs.map(org => ({ id: org, name: org })) 
    : [
        { id: "org-wallet", name: "Acme Wallet" },
        { id: "org-defi", name: "DeFi Protocol" },
        { id: "org-security", name: "Stellar Security" }
      ];

  // Active/Upcoming lightning rounds
  const activeOrUpcomingRounds = (rounds || []).filter(r => {
    const phase = getRoundPhase(r);
    return phase === "active" || phase === "upcoming";
  });

  const form = useForm<BountyFormValues>({
    resolver: zodResolver(bountyCreateSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
      type: BountyType.FixedPrice,
      organizationId: organizations[0]?.id || "",
      projectId: "",
      githubIssueUrl: "",
      description: "",
      reward: {
        amount: undefined as any,
        asset: "USDC",
      },
      bountyWindowId: "",
      milestones: [
        { title: "Milestone 1: Design & Spec", description: "", percentage: 50 },
        { title: "Milestone 2: Final Implementation", description: "", percentage: 50 },
      ],
    },
  });

  const watchType = form.watch("type");

  const handleNext = async () => {
    let fieldsToValidate: Array<keyof BountyFormValues> = [];
    if (step === 1) {
      fieldsToValidate = ["title", "type", "organizationId", "projectId", "githubIssueUrl", "description"];
    } else if (step === 2) {
      fieldsToValidate = ["reward", "deadline", "bountyWindowId", "startDate", "endDate", "milestones"];
    }

    const isValid = await form.trigger(fieldsToValidate);
    if (isValid) {
      setStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setStep(prev => prev - 1);
  };

  const parseGithubIssueNumber = (url: string): number | undefined => {
    try {
      const match = url.match(/\/issues\/(\d+)/);
      return match ? parseInt(match[1]) : undefined;
    } catch {
      return undefined;
    }
  };

  const onSubmit = async (values: BountyFormValues) => {
    const input = {
      title: values.title,
      type: values.type,
      description: values.description,
      organizationId: values.organizationId,
      projectId: values.projectId || undefined,
      githubIssueUrl: values.githubIssueUrl || "",
      githubIssueNumber: values.githubIssueUrl ? parseGithubIssueNumber(values.githubIssueUrl) : undefined,
      rewardAmount: values.reward.amount,
      rewardCurrency: values.reward.asset,
      bountyWindowId: values.bountyWindowId || undefined,
    };

    createBounty(input);
  };

  return (
    <Card className="border border-border/40 bg-card/60 backdrop-blur-md">
      <CardHeader>
        <CardTitle className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          Create New Bounty
        </CardTitle>
        <CardDescription>
          Publish a bounty to the platform for contributors to claim and build.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8 relative px-4">
          <div className="flex items-center gap-2 z-10 bg-card/90 px-2 py-1 rounded-md border border-border/20">
            <div className={cn(
              "size-7 rounded-full flex items-center justify-center font-bold text-xs transition-all",
              step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              {step > 1 ? <Check className="size-4" /> : "1"}
            </div>
            <span className={cn("text-xs font-semibold hidden sm:inline", step >= 1 ? "text-foreground" : "text-muted-foreground")}>
              Basic Info
            </span>
          </div>

          <div className={cn("flex-1 h-[2px] mx-2", step >= 2 ? "bg-primary" : "bg-border/30")} />

          <div className="flex items-center gap-2 z-10 bg-card/90 px-2 py-1 rounded-md border border-border/20">
            <div className={cn(
              "size-7 rounded-full flex items-center justify-center font-bold text-xs transition-all",
              step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              {step > 2 ? <Check className="size-4" /> : "2"}
            </div>
            <span className={cn("text-xs font-semibold hidden sm:inline", step >= 2 ? "text-foreground" : "text-muted-foreground")}>
              Rewards & Deadlines
            </span>
          </div>

          <div className={cn("flex-1 h-[2px] mx-2", step >= 3 ? "bg-primary" : "bg-border/30")} />

          <div className="flex items-center gap-2 z-10 bg-card/90 px-2 py-1 rounded-md border border-border/20">
            <div className={cn(
              "size-7 rounded-full flex items-center justify-center font-bold text-xs transition-all",
              step === 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              3
            </div>
            <span className={cn("text-xs font-semibold hidden sm:inline", step === 3 ? "text-foreground" : "text-muted-foreground")}>
              Review
            </span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* STEP 1: Basic Info */}
            {step === 1 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bounty Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Build Soroban Integration Dashboard" {...field} />
                      </FormControl>
                      <FormDescription>Choose a clear, descriptive title for the bounty.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bounty Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={BountyType.FixedPrice}>Fixed Price (Standard)</SelectItem>
                            <SelectItem value={BountyType.Competition}>Competition / Hackathon</SelectItem>
                            <SelectItem value={BountyType.MilestoneBased}>Milestone Based</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>Choose how work is structured and paid.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="organizationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select organization" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {organizations.map(org => (
                              <SelectItem key={org.id} value={org.id}>
                                {org.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>Select the organization funding this bounty.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Associated Project (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {mockProjects.map(proj => (
                            <SelectItem key={proj.id} value={proj.id}>
                              {proj.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Link this bounty to a specific project workspace.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchType === BountyType.FixedPrice && (
                  <FormField
                    control={form.control}
                    name="githubIssueUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          <Github className="size-4" />
                          GitHub Issue URL
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="https://github.com/org/repo/issues/1" {...field} />
                        </FormControl>
                        <FormDescription>Provide the GitHub issue URL linked to this Fixed Price bounty.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <MarkdownTextarea
                  form={form as any}
                  name="description"
                  label="Bounty Description"
                  description="Describe the background context, requirements, deliverables, and terms."
                  placeholder="### Overview&#10;Explain what needs to be built...&#10;&#10;### Requirements&#10;- Point 1&#10;- Point 2"
                />
              </div>
            )}

            {/* STEP 2: Rewards & Deadlines */}
            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <BudgetInput
                  form={form as any}
                  name="reward"
                  label="Reward Amount"
                  description="Specify the amount contributors will be rewarded upon completion."
                />

                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="bountyWindowId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lightning Round Window (Optional)</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Standard Bounty" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="">Standard Bounty (No Window)</SelectItem>
                            {activeOrUpcomingRounds.map(round => (
                              <SelectItem key={round.id} value={round.id}>
                                {round.name} ({getRoundPhase(round).toUpperCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>Associate this bounty with an active/upcoming Lightning Round window.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {watchType !== BountyType.Competition && (
                    <DeadlineInput
                      form={form as any}
                      name="deadline"
                      label="Bounty Deadline"
                      description="The date when submissions will close."
                    />
                  )}
                </div>

                {watchType === BountyType.Competition && (
                  <div className="grid gap-4 md:grid-cols-2 p-4 rounded-lg border border-border/40 bg-muted/30">
                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Competition Start Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a start date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="endDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Competition End Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick an end date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => {
                                  const start = form.getValues("startDate");
                                  return date < (start || new Date());
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {watchType === BountyType.MilestoneBased && (
                  <div className="space-y-4 p-4 rounded-lg border border-border/40 bg-muted/30">
                    <div>
                      <h4 className="text-sm font-semibold">Milestones Definition</h4>
                      <p className="text-xs text-muted-foreground mb-4">
                        Define progress milestones and allocate the payout percentages. Must total exactly 100%.
                      </p>
                    </div>
                    <MilestoneBuilder
                      form={form as any}
                      name="milestones"
                      maxMilestones={8}
                    />
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Review */}
            {step === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="rounded-lg border border-border/50 bg-muted/40 p-5 space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-border/30">
                    <CheckCircle2 className="size-5 text-primary" />
                    <h3 className="font-semibold text-lg">Confirm Bounty Details</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 text-sm">
                    <div>
                      <span className="text-muted-foreground block text-xs">Title</span>
                      <span className="font-medium text-foreground">{form.getValues("title")}</span>
                    </div>

                    <div>
                      <span className="text-muted-foreground block text-xs">Bounty Type</span>
                      <span className="font-medium px-2 py-0.5 rounded bg-muted border border-border/20 text-xs inline-block">
                        {form.getValues("type")}
                      </span>
                    </div>

                    <div>
                      <span className="text-muted-foreground block text-xs">Organization</span>
                      <span className="font-medium">
                        {organizations.find(o => o.id === form.getValues("organizationId"))?.name || form.getValues("organizationId")}
                      </span>
                    </div>

                    <div>
                      <span className="text-muted-foreground block text-xs">Associated Project</span>
                      <span className="font-medium">
                        {mockProjects.find(p => p.id === form.getValues("projectId"))?.name || "None"}
                      </span>
                    </div>

                    {form.getValues("githubIssueUrl") && (
                      <div className="md:col-span-2">
                        <span className="text-muted-foreground block text-xs">GitHub Issue URL</span>
                        <a 
                          href={form.getValues("githubIssueUrl")} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="font-medium text-primary hover:underline flex items-center gap-1 text-xs"
                        >
                          <Github className="size-3.5 text-foreground/80 inline" />
                          {form.getValues("githubIssueUrl")}
                        </a>
                      </div>
                    )}

                    <div>
                      <span className="text-muted-foreground block text-xs">Reward Budget</span>
                      <span className="font-bold text-primary text-base">
                        {form.getValues("reward.amount")} {form.getValues("reward.asset")}
                      </span>
                    </div>

                    {form.getValues("bountyWindowId") && (
                      <div>
                        <span className="text-muted-foreground block text-xs">Lightning Round Window</span>
                        <span className="font-medium">
                          {rounds?.find(r => r.id === form.getValues("bountyWindowId"))?.name || "Window ID " + form.getValues("bountyWindowId")}
                        </span>
                      </div>
                    )}

                    {watchType === BountyType.Competition ? (
                      <>
                        <div>
                          <span className="text-muted-foreground block text-xs">Start Date</span>
                          <span className="font-medium">
                            {form.getValues("startDate") ? format(form.getValues("startDate")!, "PPP") : "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">End Date</span>
                          <span className="font-medium text-destructive">
                            {form.getValues("endDate") ? format(form.getValues("endDate")!, "PPP") : "-"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div>
                        <span className="text-muted-foreground block text-xs">Deadline</span>
                        <span className="font-medium">
                          {form.getValues("deadline") ? format(form.getValues("deadline")!, "PPP") : "-"}
                        </span>
                      </div>
                    )}
                  </div>

                  {watchType === BountyType.MilestoneBased && form.getValues("milestones") && (
                    <div className="border-t border-border/30 pt-4 space-y-2">
                      <span className="text-muted-foreground block text-xs font-semibold">Milestones Breakdown</span>
                      <div className="space-y-2">
                        {form.getValues("milestones")!.map((m, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs p-2 rounded bg-muted/20 border border-border/10">
                            <div>
                              <span className="font-semibold text-foreground/90">Milestone {idx + 1}: {m.title}</span>
                              {m.description && <p className="text-muted-foreground text-[10px]">{m.description}</p>}
                            </div>
                            <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                              {m.percentage}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border/30 pt-4">
                    <span className="text-muted-foreground block text-xs font-semibold mb-1">Description Draft</span>
                    <div className="text-xs text-muted-foreground max-h-40 overflow-y-auto bg-muted/20 rounded p-3 border border-border/10 whitespace-pre-wrap">
                      {form.getValues("description")}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
                  <HelpCircle className="size-4 shrink-0" />
                  <span>
                    Publishing a bounty will create a transaction and index the details to the explorer network. Please double check that all details are correct.
                  </span>
                </div>
              </div>
            )}

            {/* Form Actions */}
            <div className="flex justify-between items-center pt-4 border-t border-border/20">
              {step > 1 ? (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleBack} 
                  disabled={isSubmitting}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Back
                </Button>
              ) : (
                <div />
              )}

              {step < 3 ? (
                <Button 
                  type="button" 
                  onClick={handleNext}
                >
                  Next
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <Button 
                  type="submit" 
                  className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Publish Bounty"
                  )}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
