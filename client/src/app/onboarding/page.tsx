/* Add-repository route — /onboarding. Thin wrapper; the screen lives in
   _components/AddRepoView, which declares 'use client' itself. */
import { AddRepoView } from "./_components/AddRepoView";

export default function AddRepoPage() {
  return <AddRepoView />;
}
