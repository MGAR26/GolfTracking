import { AppHeader } from "@/components/AppHeader";
import { NewTripForm } from "@/components/NewTripForm";
import { Page } from "@/components/ui";

export const metadata = { title: "New trip" };

export default function NewTripPage() {
  return (
    <>
      <AppHeader title="New trip" back="/" />
      <Page>
        <NewTripForm />
      </Page>
    </>
  );
}
