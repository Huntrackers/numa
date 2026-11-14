export type FieldDef = {
  id: string;
  label: string;
  type?: string;
  value?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  min?: string;
  step?: string;
  required?: boolean;
};
export type FormDef = {
  title: string;
  description?: string;
  fields: FieldDef[];
  onChange?: (
    values: Record<string, string>,
    changed: string,
  ) => Record<string, string> | undefined;
  submitLabel: string;
  submit: (v: Record<string, string>) => Promise<unknown>;
};
export type UIContext = {
  data: any;
  page: string;
  scope: string;
  companyId: string;
  run: (action: string, payload?: any) => Promise<any>;
  decide: (kind: string, input: any) => Promise<void>;
  form: (def: FormDef) => void;
  go: (page: string) => void;
  result: (title: string, body: string, items?: any[]) => void;
  refresh: () => Promise<void>;
};
