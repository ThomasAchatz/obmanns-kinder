-- =====================================================================
-- Fragenpaket 3
-- 1. Scherzfragen und Fragen ohne eindeutige Lösung entfernen
--    (schon gespielte werden nur ausgeblendet, damit alte Spiele lesbar bleiben)
-- 2. Eine Formulierung präzisieren
-- 3. 33 neue Fragen für Musik, Kunst & Literatur, Natur & Tiere, Essen & Trinken
-- =====================================================================

with weg as (
  select q.id from public.questions q
   where q.author_id is null and q.text in (
  'Wie viele Monate haben 28 Tage?',
  'Toms Mutter hat drei Kinder: Tick, Trick und …?',
  'Wie viele Tiere jeder Art nahm Mose mit auf die Arche?',
  'Was liegt zwischen Meer und Land?',
  'Wie schreibt man „Postbote“ ohne O?',
  'Welches Tier gilt im Verhältnis zu seinem Gewicht als das stärkste der Welt?',
  'In welchem Land trinkt man pro Kopf am meisten Kaffee?',
  'Welcher Kontinent liegt in allen vier Hemisphären?'
  )
)
update public.questions set is_active = false, deleted_at = now()
 where id in (select id from weg)
   and (exists (select 1 from public.game_questions gq where gq.question_id = questions.id)
        or exists (select 1 from public.answers a where a.question_id = questions.id));

delete from public.questions q
 where q.author_id is null and q.deleted_at is null and q.text in (
  'Wie viele Monate haben 28 Tage?',
  'Toms Mutter hat drei Kinder: Tick, Trick und …?',
  'Wie viele Tiere jeder Art nahm Mose mit auf die Arche?',
  'Was liegt zwischen Meer und Land?',
  'Wie schreibt man „Postbote“ ohne O?',
  'Welches Tier gilt im Verhältnis zu seinem Gewicht als das stärkste der Welt?',
  'In welchem Land trinkt man pro Kopf am meisten Kaffee?',
  'Welcher Kontinent liegt in allen vier Hemisphären?'
  );

update public.questions set text = 'Wer begründete das heliozentrische Weltbild, nach dem sich die Erde um die Sonne dreht?' where author_id is null and text = 'Wer entdeckte, dass sich die Erde um die Sonne dreht?';

insert into public.questions (category_id, author_id, source_label, text, correct, wrong_1, wrong_2, wrong_3, explanation)
select c.id, null, 'Startpaket', v.text, v.correct, v.w1, v.w2, v.w3, v.expl
  from (values
  ('Musik', 'Welcher Komponist wurde in Bonn geboren?', 'Ludwig van Beethoven', 'Johannes Brahms', 'Robert Schumann', 'Georg Friedrich Händel', 'Brahms stammt aus Hamburg, Schumann aus Zwickau, Händel aus Halle.'),
  ('Musik', 'Wer komponierte die Oper „Die Zauberflöte“?', 'Wolfgang Amadeus Mozart', 'Richard Wagner', 'Giuseppe Verdi', 'Giacomo Puccini', 'Uraufgeführt 1791 in Wien.'),
  ('Musik', 'Welche Band veröffentlichte 1973 das Album „The Dark Side of the Moon“?', 'Pink Floyd', 'Led Zeppelin', 'The Who', 'Genesis', null),
  ('Musik', 'Aus wie vielen Linien besteht ein Notensystem?', '5', '4', '6', '7', null),
  ('Musik', 'Welches Instrument machte Jimi Hendrix berühmt?', 'E-Gitarre', 'Schlagzeug', 'E-Bass', 'Saxofon', null),
  ('Musik', 'Aus welchem Land stammt die Band Rammstein?', 'Deutschland', 'Österreich', 'Schweiz', 'Norwegen', 'Gegründet 1994 in Berlin.'),
  ('Musik', 'Wer komponierte „Der Ring des Nibelungen“?', 'Richard Wagner', 'Richard Strauss', 'Carl Maria von Weber', 'Gustav Mahler', null),
  ('Musik', 'Welche Tonleiter besteht aus den Tönen c – d – e – f – g – a – h – c?', 'C-Dur', 'a-Moll', 'G-Dur', 'F-Dur', 'a-Moll hat dieselben Töne, beginnt aber auf a.'),
  ('Musik', 'Welches berühmte Musikfestival fand 1969 im US-Bundesstaat New York statt?', 'Woodstock', 'Monterey Pop', 'Glastonbury', 'Rock am Ring', null),
  ('Musik', 'Von welcher Sängerin stammt das Album „21“ mit „Rolling in the Deep“?', 'Adele', 'Amy Winehouse', 'Duffy', 'Lady Gaga', null),
  ('Musik', 'Welches dieser Instrumente zählt zu den Holzblasinstrumenten, obwohl es meist aus Metall ist?', 'Querflöte', 'Trompete', 'Posaune', 'Tuba', 'Entscheidend ist die Tonerzeugung, nicht das Material.'),
  ('Kunst & Literatur', 'Wer schrieb das Drama „Die Räuber“?', 'Friedrich Schiller', 'Johann Wolfgang von Goethe', 'Gotthold Ephraim Lessing', 'Heinrich von Kleist', 'Uraufgeführt 1782 in Mannheim.'),
  ('Kunst & Literatur', 'Wer malte „Die Sternennacht“?', 'Vincent van Gogh', 'Claude Monet', 'Paul Cézanne', 'Paul Gauguin', 'Entstanden 1889.'),
  ('Kunst & Literatur', 'Wer schuf die Skulptur „Der Denker“?', 'Auguste Rodin', 'Michelangelo', 'Gian Lorenzo Bernini', 'Antonio Canova', null),
  ('Kunst & Literatur', 'Wer schrieb den Roman über den Ritter Don Quijote?', 'Miguel de Cervantes', 'Lope de Vega', 'Pedro Calderón de la Barca', 'Gabriel García Márquez', null),
  ('Kunst & Literatur', 'Wer malte „Das Mädchen mit dem Perlenohrring“?', 'Jan Vermeer', 'Rembrandt van Rijn', 'Peter Paul Rubens', 'Frans Hals', null),
  ('Kunst & Literatur', 'Wer schrieb „Der kleine Prinz“?', 'Antoine de Saint-Exupéry', 'Jules Verne', 'Victor Hugo', 'Albert Camus', null),
  ('Kunst & Literatur', 'Welcher Künstler wurde unter anderem mit Bildern von Suppendosen berühmt?', 'Andy Warhol', 'Roy Lichtenstein', 'Keith Haring', 'Jackson Pollock', null),
  ('Kunst & Literatur', 'Wer schrieb den Roman „1984“?', 'George Orwell', 'Aldous Huxley', 'Ray Bradbury', 'H. G. Wells', null),
  ('Kunst & Literatur', 'Welcher deutsche Schriftsteller erhielt 1929 den Literaturnobelpreis?', 'Thomas Mann', 'Hermann Hesse', 'Heinrich Böll', 'Günter Grass', 'Hesse folgte 1946, Böll 1972, Grass 1999.'),
  ('Kunst & Literatur', 'Wer malte das Gemälde „Der Kuss“ mit viel Blattgold?', 'Gustav Klimt', 'Egon Schiele', 'Franz Marc', 'Oskar Kokoschka', null),
  ('Kunst & Literatur', 'Wer schrieb „Die unendliche Geschichte“?', 'Michael Ende', 'Cornelia Funke', 'Otfried Preußler', 'Erich Kästner', null),
  ('Natur & Tiere', 'Wie heißt das Junge eines Pferdes?', 'Fohlen', 'Kalb', 'Lamm', 'Ferkel', null),
  ('Natur & Tiere', 'Welches ist das größte heute lebende Landtier?', 'Afrikanischer Elefant', 'Giraffe', 'Breitmaulnashorn', 'Flusspferd', 'Die Giraffe ist das höchste, der Elefant das schwerste.'),
  ('Natur & Tiere', 'Wie viele Vorhöfe und Kammern hat das Herz eines Säugetiers zusammen?', '4', '2', '3', '6', 'Zwei Vorhöfe und zwei Herzkammern.'),
  ('Natur & Tiere', 'Welches dieser Säugetiere legt Eier?', 'Schnabeltier', 'Koala', 'Gürteltier', 'Faultier', null),
  ('Natur & Tiere', 'Welches Tier ist im großen bayerischen Staatswappen gleich mehrfach zu sehen?', 'Löwe', 'Adler', 'Bär', 'Hirsch', 'Der Pfälzer Löwe im Schild und zwei Löwen als Schildhalter.'),
  ('Essen & Trinken', 'Aus welchem Land stammt der Camembert?', 'Frankreich', 'Schweiz', 'Italien', 'Belgien', 'Aus der Normandie.'),
  ('Essen & Trinken', 'Aus welchem Getreide wird schottischer Single Malt Whisky gebrannt?', 'Gerste', 'Weizen', 'Mais', 'Roggen', 'Ausschließlich aus gemälzter Gerste.'),
  ('Essen & Trinken', 'Wie heißt die italienische Süßspeise aus Löffelbiskuits, Mascarpone und Kaffee?', 'Tiramisu', 'Panna cotta', 'Cannoli', 'Zabaione', null),
  ('Essen & Trinken', 'Was ist die Hauptzutat von Guacamole?', 'Avocado', 'Tomate', 'Paprika', 'Kichererbsen', null),
  ('Essen & Trinken', 'Aus welcher Stadt stammt die Sachertorte?', 'Wien', 'Salzburg', 'Graz', 'Linz', null),
  ('Essen & Trinken', 'Was ist Prosecco?', 'Ein italienischer Schaumwein', 'Ein spanischer Schaumwein', 'Ein französischer Rotwein', 'Ein Kräuterlikör', null)
  ) as v(category, text, correct, w1, w2, w3, expl)
  join public.categories c on c.name = v.category
 where not exists (select 1 from public.questions q where q.text = v.text);
