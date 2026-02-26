import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, Music, Users, Radio, Clock } from 'lucide-react';
import { ALL_DECKS, DECK_COLORS, type DeckId } from '@/types/channels';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

// ─── Mock data generators ──────────────────────────────────────────────────
function generateHourlyRequests() {
  return Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, '0')}h`,
    requests: Math.floor(Math.random() * 30 + (i >= 18 ? 20 : 2)),
  }));
}

function generateTopTracks() {
  return [
    { title: 'Midnight Drive', artist: 'Neon Pulse', plays: 47, deck: 'A' },
    { title: 'Desert Rain', artist: 'Echo Valley', plays: 38, deck: 'B' },
    { title: 'Low Frequency', artist: 'Bassline Theory', plays: 35, deck: 'A' },
    { title: 'Static Bloom', artist: 'The Wire', plays: 29, deck: 'C' },
    { title: 'Open Circuit', artist: 'Volt Room', plays: 22, deck: 'D' },
    { title: 'Ghost Signal', artist: 'Echo Valley', plays: 18, deck: 'B' },
  ];
}

function generateDeckActivity() {
  return ALL_DECKS.map(id => ({
    deck: `Deck ${id}`,
    id,
    tracksPlayed: Math.floor(Math.random() * 50 + 10),
    uptime: Math.floor(Math.random() * 100),
    listeners: Math.floor(Math.random() * 200 + 50),
  }));
}

function generateListenerTrend() {
  return Array.from({ length: 7 }, (_, i) => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return {
      day: days[i],
      listeners: Math.floor(Math.random() * 400 + 100 + (i >= 4 ? 200 : 0)),
    };
  });
}

// ─── Stat card ────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 flex gap-4 items-center">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground tracking-widest uppercase">{label}</p>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-card border rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="font-bold text-foreground">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
        ))}
      </div>
    );
  }
  return null;
};

// ─── Main page ───────────────────────────────────────────────────────────
const DECK_HEX: Record<DeckId, string> = {
  A: '#f59e0b',
  B: '#3b82f6',
  C: '#22c55e',
  D: '#a855f7',
};

export default function AnalyticsPage() {
  const navigate = useNavigate();
  const [hourly] = useState(generateHourlyRequests);
  const [topTracks] = useState(generateTopTracks);
  const [deckActivity] = useState(generateDeckActivity);
  const [listenerTrend] = useState(generateListenerTrend);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const totalRequests = hourly.reduce((s, h) => s + h.requests, 0);
  const peakHour = hourly.reduce((a, b) => b.requests > a.requests ? b : a);
  const totalListeners = deckActivity.reduce((s, d) => s + d.listeners, 0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Console
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-widest text-primary">ANALYTICS</h1>
            <p className="text-xs text-muted-foreground">
              {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground border px-3 py-1 rounded-full">Live data</span>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Music} label="Requests Today" value={String(totalRequests)}
          sub={`Peak at ${peakHour.hour}`} color="bg-amber-500/10 text-amber-400" />
        <StatCard icon={Users} label="Total Listeners" value={String(totalListeners)}
          sub="Across all decks" color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={Radio} label="Active Decks" value={String(ALL_DECKS.length)}
          sub="All channels live" color="bg-green-500/10 text-green-400" />
        <StatCard icon={Clock} label="Uptime" value="99.8%"
          sub="Last 30 days" color="bg-purple-500/10 text-purple-400" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* Hourly requests */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold tracking-wider">REQUESTS BY HOUR</h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourly} barSize={8}>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#666' }} interval={3} />
              <YAxis tick={{ fontSize: 9, fill: '#666' }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="requests" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Listener trend */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-bold tracking-wider">LISTENER TREND (7 DAYS)</h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={listenerTrend}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="listeners" stroke="#3b82f6"
                strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} name="Listeners" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top tracks */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Music className="h-4 w-4 text-green-400" />
            <h2 className="text-sm font-bold tracking-wider">TOP TRACKS</h2>
          </div>
          <div className="space-y-2">
            {topTracks.map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-semibold truncate">{t.title}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold" style={{ color: DECK_HEX[t.deck as DeckId] }}>
                        {t.deck}
                      </span>
                      <span className="text-xs text-muted-foreground">{t.plays} plays</span>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1">
                    <div
                      className="h-1 rounded-full transition-all"
                      style={{
                        width: `${(t.plays / topTracks[0].plays) * 100}%`,
                        background: DECK_HEX[t.deck as DeckId],
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Deck activity pie */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-bold tracking-wider">DECK ACTIVITY</h2>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={deckActivity}
                dataKey="tracksPlayed"
                nameKey="deck"
                cx="50%" cy="50%"
                outerRadius={60}
                strokeWidth={0}
              >
                {deckActivity.map((d) => (
                  <Cell key={d.id} fill={DECK_HEX[d.id]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-1 mt-2">
            {deckActivity.map(d => (
              <div key={d.id} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: DECK_HEX[d.id] }} />
                <span className="text-[10px] text-muted-foreground">Deck {d.id}: {d.tracksPlayed}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
