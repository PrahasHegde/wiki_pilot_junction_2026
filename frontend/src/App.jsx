import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useApp } from "./store";
import { api } from "./lib";
import { Footer, Header, Sidebar, TimeBar } from "./components/shell";
import Palette from "./components/Palette";
import { Page } from "./components/ui";
import Home from "./views/Home";
import Ask from "./views/Ask";
import Machine from "./views/Machine";
import Radar from "./views/Radar";
import Lens from "./views/Lens";
import StudioPage from "./views/StudioPage";

const TRY = [
  ["#ask/" + encodeURIComponent("What did Wikipedia say about the 1918 prison camps in 2008, and what has changed since?"), "1918 camps: then vs now"],
  ["#ask/" + encodeURIComponent("How has Wikipedia's account of who started the Winter War changed over the years?"), "Winter War story drift"],
  ["#machine/1256", "Talvisota through time"],
  ["#lens/1256", "Compare 3 Wikipedias"],
];

export default function App() {
  const { route } = useApp();
  const [stats, setStats] = useState(null);
  const [nav, setNav] = useState(() => innerWidth > 900);
  const [palette, setPalette] = useState(false);
  const [playFrom, setPlayFrom] = useState(null);

  useEffect(() => { api("/api/stats").then(setStats).catch(() => {}); }, []);
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); document.querySelector(".hdr .search input")?.focus(); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  useEffect(() => { if (innerWidth <= 900) setNav(false); }, [route]);

  const v = route.view;
  return (
    <>
      <a className="skip" href="#content">Skip to content</a>
      <Header onMenu={() => setNav(!nav)} onPalette={() => setPalette(true)} />
      <TimeBar playFrom={v === "machine" ? playFrom : null} />
      <div className={"page" + (nav ? "" : " nav-closed")}>
        <Sidebar stats={stats} open={nav} tryLinks={TRY} />
        <main className="content" id="content">
          <AnimatePresence mode="wait">
            {v === "ask" ? <Page k="ask"><Ask /></Page>
              : v === "machine" ? <Page k="machine"><Machine onPlayFrom={setPlayFrom} /></Page>
              : v === "studio" ? <Page k="studio"><StudioPage /></Page>
              : v === "radar" ? <Page k="radar"><Radar /></Page>
              : v === "lens" ? <Page k="lens"><Lens /></Page>
              : <Page k="home"><Home stats={stats} /></Page>}
          </AnimatePresence>
        </main>
      </div>
      <Footer />
      <Palette open={palette} onClose={() => setPalette(false)} />
    </>
  );
}
