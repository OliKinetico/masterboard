"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  Clinic,
  Comment,
  Contact,
  Deal,
  DealChecklist,
  DealChecklistItem,
  DocumentRow,
  DocumentStatusHistory,
  Interaction,
  Offer,
  Property,
  StageHistory,
  Task,
} from "@/lib/types";
import type { UserRole } from "@/lib/domain";
import { Timeline } from "./timeline";
import { KeyInfoTab } from "./key-info-tab";
import { OffersTab } from "./offers-tab";
import { PropertiesTab } from "./properties-tab";
import { LegalTab } from "./legal-tab";
import { ChecklistsTab } from "./checklists-tab";
import { DocumentsTab } from "./documents-tab";
import { ContactsTab } from "./contacts-tab";
import { TasksTab } from "./tasks-tab";
import { CommentsTab } from "./comments-tab";

export function DealTabs(props: {
  deal: Deal;
  clinics: Clinic[];
  offers: Offer[];
  properties: Property[];
  documents: DocumentRow[];
  docHistory: DocumentStatusHistory[];
  checklists: Array<DealChecklist & { deal_checklist_items: DealChecklistItem[] }>;
  tasks: Task[];
  comments: Comment[];
  contacts: Contact[];
  interactions: Interaction[];
  stageHistory: StageHistory[];
  profilesById: Record<string, string>;
  role: UserRole;
}) {
  const staff = props.role === "admin" || props.role === "deal_lead";
  const openTasks = props.tasks.filter((t) => t.status === "open").length;
  const unsignedDocs = props.documents.filter((d) => d.status !== "signed").length;

  return (
    <Tabs defaultValue="timeline">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="key-info">Key info</TabsTrigger>
        <TabsTrigger value="offers">
          Offers{props.offers.length ? ` · ${props.offers.length}` : ""}
        </TabsTrigger>
        <TabsTrigger value="properties">
          Properties{props.properties.length ? ` · ${props.properties.length}` : ""}
        </TabsTrigger>
        <TabsTrigger value="legal">
          Legal{unsignedDocs ? ` · ${unsignedDocs}` : ""}
        </TabsTrigger>
        <TabsTrigger value="checklists">Checklists</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="tasks">
          Tasks{openTasks ? ` · ${openTasks}` : ""}
        </TabsTrigger>
        <TabsTrigger value="comments">Comments</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline">
        <Timeline
          dealId={props.deal.id}
          initial={props.interactions}
          contacts={props.contacts}
          stageHistory={props.stageHistory}
          canLog={staff}
        />
      </TabsContent>
      <TabsContent value="key-info">
        <KeyInfoTab deal={props.deal} clinics={props.clinics} canEdit={staff} />
      </TabsContent>
      <TabsContent value="offers">
        <OffersTab dealId={props.deal.id} offers={props.offers} canEdit={staff} />
      </TabsContent>
      <TabsContent value="properties">
        <PropertiesTab
          dealId={props.deal.id}
          properties={props.properties}
          clinics={props.clinics}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="legal">
        <LegalTab
          deal={props.deal}
          documents={props.documents}
          docHistory={props.docHistory}
          properties={props.properties}
          profilesById={props.profilesById}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="checklists">
        <ChecklistsTab
          dealId={props.deal.id}
          checklists={props.checklists}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentsTab
          dealId={props.deal.id}
          documents={props.documents}
          properties={props.properties}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="contacts">
        <ContactsTab
          clinics={props.clinics}
          contacts={props.contacts}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksTab
          dealId={props.deal.id}
          tasks={props.tasks}
          profilesById={props.profilesById}
          canEdit={staff}
        />
      </TabsContent>
      <TabsContent value="comments">
        <CommentsTab
          dealId={props.deal.id}
          comments={props.comments}
          profilesById={props.profilesById}
          canComment={staff || props.role === "exec"}
        />
      </TabsContent>
    </Tabs>
  );
}
