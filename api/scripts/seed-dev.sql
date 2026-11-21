-- The real sites. Local dev works too because the dev API runs with ALLOW_LOCALHOST=true.
INSERT INTO sites (id, domain, name, is_public) VALUES
  ('portfolio',           'adnanradjam.com',            'Portfolio',           true),
  ('reanimated-cookbook', 'reanimated.adnanradjam.com', 'Reanimated Cookbook', false),
  ('quran-repeater',      'quran-repeater.adnanradjam.com', 'Quran Repeater',  false)
ON CONFLICT (id) DO UPDATE SET domain = EXCLUDED.domain, name = EXCLUDED.name;
