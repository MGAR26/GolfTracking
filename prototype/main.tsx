import { createRoot } from "react-dom/client";
import { AppProvider, useApp } from "./App";
import { HomeScreen, NewTripScreen, TripScreen, NewRoundScreen, MoneyScreen, RoundScreen } from "./screens";

function Router() {
  const { route } = useApp();
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "newTrip":
      return <NewTripScreen />;
    case "trip":
      return <TripScreen tripId={route.tripId} />;
    case "newRound":
      return <NewRoundScreen tripId={route.tripId} />;
    case "money":
      return <MoneyScreen tripId={route.tripId} />;
    case "round":
      return <RoundScreen route={route} />;
  }
}

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <Router />
  </AppProvider>,
);
