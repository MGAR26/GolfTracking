import { createRoot } from "react-dom/client";
import { AppProvider, useApp } from "./App";
import { HomeScreen, NewTripScreen, NewRoundScreen, RoundScreen } from "./screens";
import { FirstRunScreen, RoundStoryScreen, SettleScreen, TripHomeScreen, firstRunDone } from "./TripScreens";
import { useState } from "react";

function Router() {
  const { route } = useApp();
  // once per phone, before anything else: install + location
  const [setup, setSetup] = useState(() => !firstRunDone());
  if (setup) return <FirstRunScreen onDone={() => setSetup(false)} />;
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "newTrip":
      return <NewTripScreen />;
    case "trip":
      return <TripHomeScreen tripId={route.tripId} />;
    case "newRound":
      return <NewRoundScreen tripId={route.tripId} />;
    case "money":
      return <SettleScreen tripId={route.tripId} />;
    case "story":
      return <RoundStoryScreen roundId={route.roundId} />;
    case "round":
      return <RoundScreen route={route} />;
  }
}

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <Router />
  </AppProvider>,
);
