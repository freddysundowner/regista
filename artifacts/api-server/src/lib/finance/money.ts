import { Prisma } from "@workspace/db";
export const zero = () => new Prisma.Decimal("0.00");
export function money(value: string) {
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) throw new Error("Money must be a decimal string with at most two decimal places");
  return new Prisma.Decimal(value);
}
export const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), zero());
export const minimum = (a: Prisma.Decimal, b: Prisma.Decimal) => a.lessThan(b) ? a : b;