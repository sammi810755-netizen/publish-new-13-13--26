import { Redirect } from "expo-router";

// Workspace is now the app's home screen ("/"). This route redirects any legacy
// links (router.push("/workspace")) to the root so nothing breaks.
export default function WorkspaceRedirect() {
  return <Redirect href="/" />;
}
