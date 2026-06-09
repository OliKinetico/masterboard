/** Pipedrive migration contracts (spec §5.8). */

export interface PdOrg {
  id: string;
  name: string;
  address: string;
  postcode: string;
}

export interface PdPerson {
  id: string;
  name: string;
  email: string;
  phone: string;
  org_id: string;
}

export interface PdDeal {
  id: string;
  title: string;
  org_id: string;
  stage: string;
  status: string; // open | won | lost
  value: string;
  add_time: string;
  lost_reason: string;
}

export interface PdNote {
  id: string;
  deal_id: string;
  content: string;
  add_time: string;
}

export interface PdActivity {
  id: string;
  deal_id: string;
  type: string; // call | meeting | email | task
  subject: string;
  note: string;
  due_date: string;
  done: string;
}

export interface PdFile {
  id: string;
  deal_id: string;
  name: string;
  url: string;
}

export interface PipedriveData {
  orgs: PdOrg[];
  persons: PdPerson[];
  deals: PdDeal[];
  notes: PdNote[];
  activities: PdActivity[];
  files: PdFile[];
}

export interface PipedriveProvider {
  readonly name: string;
  fetchAll(): Promise<PipedriveData>;
}
