"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { type UseFormReturn, type FieldValues } from "react-hook-form"

const ASSETS = [
  { value: "XLM", label: "XLM" },
  { value: "USDC", label: "USDC" },
  { value: "EURC", label: "EURC" },
] as const

type Asset = (typeof ASSETS)[number]["value"]

interface BudgetInputProps {
  form: UseFormReturn<FieldValues>
  name: string
  label?: string
  description?: string
}

export function BudgetInput({
  form,
  name,
  label,
  description,
}: BudgetInputProps) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_200px]">
      <FormField
        control={form.control}
        name={`${name}.amount`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label || "Budget Amount"}</FormLabel>
            <FormControl>
              <Input
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                {...field}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value)
                  field.onChange(Number.isNaN(parsed) ? undefined : parsed)
                }}
              />
            </FormControl>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name={`${name}.asset`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Asset</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value as Asset}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {ASSETS.map((asset) => (
                  <SelectItem key={asset.value} value={asset.value}>
                    {asset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
