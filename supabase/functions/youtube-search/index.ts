import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('YOUTUBE_API_KEY');
    if (!apiKey) {
      throw new Error('YOUTUBE_API_KEY is not configured');
    }

    const url = new URL(req.url);
    const query = url.searchParams.get('q');
    const maxResults = url.searchParams.get('maxResults') || '10';

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing query parameter "q"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${apiKey}`;
    const ytRes = await fetch(ytUrl);
    const data = await ytRes.json();

    if (!ytRes.ok) {
      throw new Error(`YouTube API error [${ytRes.status}]: ${JSON.stringify(data)}`);
    }

    const results = (data.items || []).map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('YouTube search error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
