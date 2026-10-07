-- =====================================================================
-- Durchsicht aller Startpaket-Fragen: 40 Korrekturen, 5 entfernt.
-- (Fragen von Spielern bleiben unberührt.)
-- =====================================================================
update public.questions set text = 'In welcher Stadt steht das Brandenburger Tor?', correct = 'Berlin', wrong_1 = 'Dresden', wrong_2 = 'Hamburg', wrong_3 = 'Leipzig', explanation = null, updated_at = now()
 where author_id is null and text = 'In welcher Stadt steht das Brandenburger Tor?';
update public.questions set text = 'Welches Sprichwort zeigen diese Emojis: 🐦✋ > 🕊️🏠', correct = 'Lieber den Spatz in der Hand als die Taube auf dem Dach', wrong_1 = 'Der frühe Vogel fängt den Wurm', wrong_2 = 'Eine Schwalbe macht noch keinen Sommer', wrong_3 = 'Morgenstund hat Gold im Mund', explanation = null, updated_at = now()
 where author_id is null and text = 'Welches Sprichwort zeigen diese Emojis: 🐦✋ > 🕊️🏠';
update public.questions set text = 'Welche Form hat das Stoppschild in Deutschland?', correct = 'Achteck', wrong_1 = 'Dreieck', wrong_2 = 'Kreis', wrong_3 = 'Raute', explanation = 'Die besondere Form ist auch dann noch erkennbar, wenn das Schild verschmutzt oder mit Schnee bedeckt ist.', updated_at = now()
 where author_id is null and text = 'Welche Form hat das Stoppschild in Deutschland?';
update public.questions set text = 'Welches Schreibgerät ließ sich der Ungar László Bíró 1938 patentieren?', correct = 'Den Kugelschreiber', wrong_1 = 'Den Füllfederhalter', wrong_2 = 'Den Filzstift', wrong_3 = 'Den Druckbleistift', explanation = 'In Großbritannien wird der Kugelschreiber oft einfach „Biro“ genannt.', updated_at = now()
 where author_id is null and text = 'Welches Schreibgerät ließ sich der Ungar László Bíró 1938 patentieren?';
update public.questions set text = 'Wer war der erste Bundeskanzler der Bundesrepublik Deutschland?', correct = 'Konrad Adenauer', wrong_1 = 'Ludwig Erhard', wrong_2 = 'Willy Brandt', wrong_3 = 'Theodor Heuss', explanation = 'Adenauer war von 1949 bis 1963 Bundeskanzler.', updated_at = now()
 where author_id is null and text = 'Wer war der erste Bundeskanzler der Bundesrepublik Deutschland?';
update public.questions set text = 'Welcher berüchtigte Gangsterboss beherrschte in den 1920ern Chicago?', correct = 'Al Capone', wrong_1 = 'Lucky Luciano', wrong_2 = 'John Dillinger', wrong_3 = 'Dutch Schultz', explanation = null, updated_at = now()
 where author_id is null and text = 'Welcher berüchtigte Gangsterboss beherrschte in den 1920ern Chicago?';
update public.questions set text = 'Welche Augsburger Familie stiftete 1521 eine Sozialsiedlung, die zu den ältesten bestehenden der Welt zählt?', correct = 'Die Fugger', wrong_1 = 'Die Welser', wrong_2 = 'Die Medici', wrong_3 = 'Die Rothschild', explanation = 'Stifter war Jakob Fugger „der Reiche“; die Jahreskaltmiete entspricht nominell einem Rheinischen Gulden, umgerechnet 0,88 Euro.', updated_at = now()
 where author_id is null and text = 'Welche Augsburger Familie gründete 1521 die älteste bestehende Sozialsiedlung der Welt?';
update public.questions set text = 'Welches Automodell wurde als erstes am laufenden Fließband in Masse gebaut?', correct = 'Ford Model T', wrong_1 = 'VW Käfer', wrong_2 = 'Opel Laubfrosch', wrong_3 = 'Mercedes Simplex', explanation = 'Die Montagezeit pro Auto sank dadurch von über zwölf auf etwa eineinhalb Stunden.', updated_at = now()
 where author_id is null and text = 'Welches Automodell wurde ab 1913 als erstes am laufenden Fließband in Masse gebaut?';
update public.questions set text = 'Unter welchem römischen Kaiser brannten im Jahr 64 große Teile Roms nieder?', correct = 'Nero', wrong_1 = 'Caligula', wrong_2 = 'Tiberius', wrong_3 = 'Claudius', explanation = null, updated_at = now()
 where author_id is null and text = 'Unter welchem römischen Kaiser brannte im Jahr 64 große Teile Roms nieder?';
update public.questions set text = 'Welcher ist der längste Fluss Europas?', correct = 'Wolga', wrong_1 = 'Donau', wrong_2 = 'Rhein', wrong_3 = 'Dnepr', explanation = 'Die Wolga ist rund 3.500 km lang.', updated_at = now()
 where author_id is null and text = 'Welcher ist der längste Fluss Europas?';
update public.questions set text = 'Welcher Fluss gilt meist als der längste der Welt?', correct = 'Nil', wrong_1 = 'Kongo', wrong_2 = 'Jangtse', wrong_3 = 'Mississippi', explanation = 'Einige Messungen sehen allerdings den Amazonas vorn.', updated_at = now()
 where author_id is null and text = 'Welcher Fluss gilt meist als der längste der Welt?';
update public.questions set text = 'Aus wie vielen Kantonen besteht die Schweiz?', correct = '26', wrong_1 = '21', wrong_2 = '24', wrong_3 = '28', explanation = 'Sechs davon wurden früher als Halbkantone bezeichnet, etwa Basel-Stadt und Basel-Landschaft.', updated_at = now()
 where author_id is null and text = 'Aus wie vielen Kantonen besteht die Schweiz?';
update public.questions set text = 'Welches ist nach geografischer Definition (sehr wenig Niederschlag) die größte Wüste der Erde?', correct = 'Antarktis', wrong_1 = 'Sahara', wrong_2 = 'Gobi', wrong_3 = 'Arabische Wüste', explanation = 'Auch die Antarktis erhält so wenig Niederschlag, dass sie als Wüste gilt – und sie ist deutlich größer als die Sahara.', updated_at = now()
 where author_id is null and text = 'Welches ist die größte Wüste der Erde?';
update public.questions set text = 'In welchem US-Bundesstaat liegt der höchste Berg der USA?', correct = 'Alaska', wrong_1 = 'Kalifornien', wrong_2 = 'Colorado', wrong_3 = 'Washington', explanation = 'Der Denali, auch Mount McKinley genannt, ist rund 6.190 m hoch.', updated_at = now()
 where author_id is null and text = 'Welches ist der höchste Berg der USA?';
update public.questions set text = 'Was ist die Hauptstadt der Türkei?', correct = 'Ankara', wrong_1 = 'Istanbul', wrong_2 = 'Izmir', wrong_3 = 'Bursa', explanation = 'Atatürk machte Ankara 1923 anstelle von Istanbul zur Hauptstadt.', updated_at = now()
 where author_id is null and text = 'Was ist die Hauptstadt der Türkei?';
update public.questions set text = 'Welche Nordseeinsel ist seit 1927 über den als „Hindenburgdamm“ bekannten Bahndamm mit dem Festland verbunden?', correct = 'Sylt', wrong_1 = 'Föhr', wrong_2 = 'Amrum', wrong_3 = 'Pellworm', explanation = 'Auf dem Damm fahren nur Züge, Autos kommen per Autozug auf die Insel.', updated_at = now()
 where author_id is null and text = 'Welche Nordseeinsel ist seit 1927 über den als „Hindenburgdamm“ bekannten Bahndamm mit dem Festland verbunden?';
update public.questions set text = 'In welchem Land liegt die Stadt Timbuktu?', correct = 'Mali', wrong_1 = 'Niger', wrong_2 = 'Mauretanien', wrong_3 = 'Burkina Faso', explanation = 'Ihre Lehmmoscheen gehören zum UNESCO-Welterbe.', updated_at = now()
 where author_id is null and text = 'In welchem Land liegt die Stadt Timbuktu?';
update public.questions set text = 'Wie lautet der traditionelle englische Sammelbegriff für eine Gruppe Krähen?', correct = 'A murder', wrong_1 = 'A gaggle', wrong_2 = 'A murmuration', wrong_3 = 'A party', explanation = '„A murder of crows“ – ähnlich bildhaft heißt eine Gruppe Gänse „a gaggle“ und ein Starenschwarm „a murmuration“.', updated_at = now()
 where author_id is null and text = 'Wie heißt eine Gruppe Krähen auf Englisch?';
update public.questions set text = 'Welches ist das schwerste heute lebende Landtier?', correct = 'Afrikanischer Elefant', wrong_1 = 'Giraffe', wrong_2 = 'Breitmaulnashorn', wrong_3 = 'Flusspferd', explanation = 'Die Giraffe ist dagegen das höchste heute lebende Landtier.', updated_at = now()
 where author_id is null and text = 'Welches ist das größte heute lebende Landtier?';
update public.questions set text = 'Welches Tier ist im großen bayerischen Staatswappen gleich mehrfach zu sehen?', correct = 'Löwe', wrong_1 = 'Adler', wrong_2 = 'Bär', wrong_3 = 'Hirsch', explanation = 'Der goldene Pfälzer Löwe, drei schwarze Stauferlöwen für Schwaben und zwei goldene Löwen als Schildhalter.', updated_at = now()
 where author_id is null and text = 'Welches Tier ist im großen bayerischen Staatswappen gleich mehrfach zu sehen?';
update public.questions set text = 'Wie viele chemische Elemente umfasste das Periodensystem, als 2016 die letzten Neuzugänge wie Nihonium und Oganesson ihre Namen erhielten?', correct = '118', wrong_1 = '92', wrong_2 = '108', wrong_3 = '126', explanation = 'Mit diesen Benennungen war die siebte Periode des Periodensystems erstmals vollständig gefüllt.', updated_at = now()
 where author_id is null and text = 'Wie viele chemische Elemente sind im Periodensystem bekannt?';
update public.questions set text = 'Wer baute 1885 mit Wilhelm Maybach den „Reitwagen“, der als erstes Motorrad gilt?', correct = 'Gottlieb Daimler', wrong_1 = 'Carl Benz', wrong_2 = 'Nikolaus August Otto', wrong_3 = 'August Horch', explanation = 'Die erste Fahrt unternahm Daimlers Sohn Paul am 10. November 1885 von Cannstatt nach Untertürkheim und zurück.', updated_at = now()
 where author_id is null and text = 'Wer baute 1885 mit Wilhelm Maybach den „Reitwagen“, der als erstes Motorrad gilt?';
update public.questions set text = 'In welchem Jahr nahm der ICE in Deutschland den regulären Linienbetrieb auf?', correct = '1991', wrong_1 = '1981', wrong_2 = '1985', wrong_3 = '1999', explanation = 'Die erste ICE-Linie verband ab Juni 1991 Hamburg über Frankfurt mit München.', updated_at = now()
 where author_id is null and text = 'Seit welchem Jahr fährt der ICE in Deutschland im regulären Linienbetrieb?';
update public.questions set text = 'Welcher Verein wurde von 2013 bis 2023 elfmal in Folge deutscher Fußballmeister?', correct = 'FC Bayern München', wrong_1 = 'Borussia Dortmund', wrong_2 = 'RB Leipzig', wrong_3 = 'VfL Wolfsburg', explanation = 'Die Serie endete 2024, als Bayer 04 Leverkusen ohne eine einzige Niederlage Meister wurde.', updated_at = now()
 where author_id is null and text = 'Welcher Verein ist deutscher Rekordmeister im Fußball der Männer?';
update public.questions set text = 'Welcher Golfer gewann 1986 mit 46 Jahren das Masters und damit seinen 18. Major-Titel?', correct = 'Jack Nicklaus', wrong_1 = 'Arnold Palmer', wrong_2 = 'Gary Player', wrong_3 = 'Tom Watson', explanation = 'Der Amerikaner trug den Spitznamen „Golden Bear“.', updated_at = now()
 where author_id is null and text = 'Welcher Golfer hat die meisten Major-Turniere gewonnen?';
update public.questions set text = 'Bei welchem Tennisturnier müssen die Spieler fast ganz in Weiß antreten?', correct = 'Wimbledon', wrong_1 = 'US Open', wrong_2 = 'French Open', wrong_3 = 'Australian Open', explanation = 'Das 1877 erstmals ausgetragene Turnier gilt als ältestes Tennisturnier der Welt und wird auf Rasen in London gespielt.', updated_at = now()
 where author_id is null and text = 'Bei welchem Tennisturnier müssen Spieler komplett in Weiß antreten?';
update public.questions set text = 'Welche deutsche Krimireihe startete 1970 im Fernsehen?', correct = 'Tatort', wrong_1 = 'Derrick', wrong_2 = 'Der Alte', wrong_3 = 'Polizeiruf 110', explanation = 'Die erste Folge „Taxi nach Leipzig“ lief am 29. November 1970; der „Polizeiruf 110“ startete 1971.', updated_at = now()
 where author_id is null and text = 'Welche deutsche Krimireihe läuft seit 1970 im Fernsehen?';
update public.questions set text = 'In der Nähe welcher Stadt liegt das europäische Disneyland?', correct = 'Paris', wrong_1 = 'London', wrong_2 = 'Madrid', wrong_3 = 'München', explanation = 'Das Resort liegt größtenteils in der Gemeinde Chessy, 32 km östlich von Paris, und öffnete 1992.', updated_at = now()
 where author_id is null and text = 'In welcher Stadt steht das europäische Disneyland?';
update public.questions set text = 'Wer gewann als Einzelperson mehr als 20 Oscars?', correct = 'Walt Disney', wrong_1 = 'Steven Spielberg', wrong_2 = 'Meryl Streep', wrong_3 = 'John Williams', explanation = null, updated_at = now()
 where author_id is null and text = 'Wer hat die meisten Oscars aller Zeiten gewonnen?';
update public.questions set text = 'In welchem Disney-Film singt Bär Balu „Probier’s mal mit Gemütlichkeit“?', correct = 'Das Dschungelbuch', wrong_1 = 'Robin Hood', wrong_2 = 'Aristocats', wrong_3 = 'Bernard und Bianca', explanation = 'Es war der letzte Zeichentrickfilm, den Walt Disney selbst produzierte; er starb im Dezember 1966 noch während der Produktion.', updated_at = now()
 where author_id is null and text = 'In welchem Disney-Film singt Bär Balu „Probier’s mal mit Gemütlichkeit“?';
update public.questions set text = 'Welcher Moderator lebte in der ZDF-Sendung „Löwenzahn“ ab 1981 in einem Bauwagen?', correct = 'Peter Lustig', wrong_1 = 'Armin Maiwald', wrong_2 = 'Christoph Biemann', wrong_3 = 'Ralph Caspers', explanation = 'Am Ende der Folgen forderte er die Kinder sinngemäß auf, jetzt den Fernseher abzuschalten.', updated_at = now()
 where author_id is null and text = 'Welcher Moderator lebte in der ZDF-Sendung „Löwenzahn“ ab 1981 in einem Bauwagen?';
update public.questions set text = 'In welcher Stadt ermittelte „Kommissar Rex“ ursprünglich?', correct = 'Wien', wrong_1 = 'Graz', wrong_2 = 'Salzburg', wrong_3 = 'Innsbruck', explanation = 'Die Originalserie wurde von 1994 bis 2004 in Wien gedreht; ab 2007 entstand für die Rai eine italienische Neuauflage mit Schauplatz Rom.', updated_at = now()
 where author_id is null and text = 'In welcher Stadt ermittelte „Kommissar Rex“ ursprünglich?';
update public.questions set text = 'Wer war bis 2017 Leadsänger der Band Linkin Park?', correct = 'Chester Bennington', wrong_1 = 'Chris Cornell', wrong_2 = 'Scott Weiland', wrong_3 = 'Dave Grohl', explanation = null, updated_at = now()
 where author_id is null and text = 'Wer war der Sänger von Linkin Park bis 2017?';
update public.questions set text = 'Wer wurde als Sänger der Rolling Stones weltberühmt?', correct = 'Mick Jagger', wrong_1 = 'Rod Stewart', wrong_2 = 'Roger Daltrey', wrong_3 = 'Steven Tyler', explanation = 'Roger Daltrey wurde als Sänger von The Who bekannt, Steven Tyler als Sänger von Aerosmith.', updated_at = now()
 where author_id is null and text = 'Wer ist der Sänger der Rolling Stones?';
update public.questions set text = 'Welche Stout-Marke stammt aus der Dubliner Brauerei am St. James’s Gate?', correct = 'Guinness', wrong_1 = 'Murphy’s', wrong_2 = 'Beamish', wrong_3 = 'O’Hara’s', explanation = 'Arthur Guinness pachtete das Brauereigelände am 31. Dezember 1759 – für 9.000 Jahre.', updated_at = now()
 where author_id is null and text = 'Welches ist das meistverkaufte Stout-Bier der Welt?';
update public.questions set text = 'Was ist Beaujolais?', correct = 'Ein Rotwein', wrong_1 = 'Ein Käse', wrong_2 = 'Ein Weinbrand', wrong_3 = 'Ein Likör', explanation = 'Gekeltert wird er fast immer aus der Rebsorte Gamay.', updated_at = now()
 where author_id is null and text = 'Was ist Beaujolais?';
update public.questions set text = 'Was unterscheidet Cognac von anderem Weinbrand?', correct = 'Er muss aus der Region um Cognac stammen', wrong_1 = 'Er muss aus Rotwein gebrannt werden', wrong_2 = 'Er muss mindestens zehn Jahre reifen', wrong_3 = 'Er darf keinen Zucker enthalten', explanation = 'Gebrannt wird er vor allem aus der weißen Rebsorte Ugni Blanc; er reift mindestens zwei Jahre in Eichenfässern.', updated_at = now()
 where author_id is null and text = 'Was unterscheidet Cognac von anderem Weinbrand?';
update public.questions set text = 'In welcher Stadt braute der Vilshofener Braumeister Josef Groll 1842 ein neuartiges helles Lagerbier?', correct = 'Pilsen', wrong_1 = 'Budweis', wrong_2 = 'Prag', wrong_3 = 'Brünn', explanation = 'Nach dieser Stadt ist die Biersorte Pils benannt; Grolls erster Sud dort stammt vom 5. Oktober 1842.', updated_at = now()
 where author_id is null and text = 'In welcher Stadt wurde 1842 das erste Bier nach Pilsner Brauart gebraut?';
update public.questions set text = 'Wer schrieb „Faust“?', correct = 'Johann Wolfgang von Goethe', wrong_1 = 'Friedrich Schiller', wrong_2 = 'Heinrich von Kleist', wrong_3 = 'Theodor Fontane', explanation = null, updated_at = now()
 where author_id is null and text = 'Wer schrieb „Faust“?';
update public.questions set text = 'Welcher Brite ließ ab 1801 zahlreiche Skulpturen vom Parthenon in Athen nach Großbritannien bringen?', correct = 'Lord Elgin', wrong_1 = 'Lord Byron', wrong_2 = 'Lord Nelson', wrong_3 = 'Lord Castlereagh', explanation = 'Nach ihm heißen sie auch „Elgin Marbles“; 1816 kaufte das britische Parlament sie für das British Museum.', updated_at = now()
 where author_id is null and text = 'Wo sind die Parthenon-Skulpturen aus Athen heute größtenteils ausgestellt?';

-- Schon gespielte Fragen nur ausblenden, damit alte Spiele lesbar bleiben
update public.questions set is_active = false, deleted_at = now()
 where author_id is null and deleted_at is null and text in (
  'Wie viele Minuten hat ein Tag?',
  'Durch welche dieser Hauptstädte fließt die Donau nicht?',
  'Welches chemische Symbol hat Silber?',
  'Welches Tennisturnier wird auf Rasen in London gespielt?',
  'Welcher Maler schnitt sich 1888 einen Teil seines Ohrs ab?')
   and (exists (select 1 from public.game_questions gq where gq.question_id = questions.id)
        or exists (select 1 from public.answers a where a.question_id = questions.id));
delete from public.questions q
 where q.author_id is null and q.deleted_at is null and q.text in (
  'Wie viele Minuten hat ein Tag?',
  'Durch welche dieser Hauptstädte fließt die Donau nicht?',
  'Welches chemische Symbol hat Silber?',
  'Welches Tennisturnier wird auf Rasen in London gespielt?',
  'Welcher Maler schnitt sich 1888 einen Teil seines Ohrs ab?');
