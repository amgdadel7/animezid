export type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };
  for (const input of inputs) walk(input);
  return out.join(" ");
}
