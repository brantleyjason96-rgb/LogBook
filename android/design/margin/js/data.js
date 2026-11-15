/* Sample data only. Everything here is made up (brief section 8). No real names, no student data.
   "Now" is fixed at Sunday 15 November 2026, 4:12 PM so every screen is repeatable. */
window.LB_DATA = (function () {
  var TODAY = '2026-11-15';
  var people = [
    { ref: 'n:maria-alvarez', name: 'Maria Alvarez', greet: 'Maria', ini: 'MA', met: 6, usualGap: 12, first: 'Aug 30, 2026', months: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2],
      topics: ['coaching', 'interview', 'rubric', 'lake loop'], places: [['Lakeside Park', 3], ['School', 2], ["Hazel's Coffee", 1]],
      draft: 'Hi Maria, I was thinking of you. Last time we talked about the instructional coach job. How is that going?' },
    { ref: 'n:priya-nair', name: 'Priya Nair', greet: 'Priya', ini: 'PN', met: 9, usualGap: 7, first: 'May 3, 2026', months: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2],
      topics: ['garden', 'soil', 'run club', 'maps'], places: [['Farmers market', 4], ['Run club', 3], ['School garden', 2]],
      draft: 'Hi Priya, I was thinking of you. Last time we talked about the soil sample kit. How is that going? I still want to bring the kit Monday.' },
    { ref: 'n:ms-gamilah', name: 'Ms. Gamilah', greet: 'Ms. Gamilah', ini: 'G', met: 7, usualGap: 5, first: 'Sep 8, 2026', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3],
      topics: ['rubric', 'WIDA', 'sentence starters', 'lab report'], places: [['School', 7]],
      draft: 'Hi Ms. Gamilah, I was thinking of you. Last time we talked about the rubric language for the lab report. How is that going?' },
    { ref: 'n:dev-patel', name: 'Dev Patel', greet: 'Dev', ini: 'DP', met: 11, usualGap: 14, first: 'Jan 17, 2026', months: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0],
      topics: ['climbing', 'moving', 'routes'], places: [['Climbing gym', 8], ['Taqueria', 3]],
      draft: 'Hi Dev, it has been about 4 weeks since we caught up. Last time we talked about moving apartments in December. How is that going?' },
    { ref: 'n:dr-okafor', name: 'Dr. Okafor', greet: 'Dr. Okafor', ini: 'O', met: 14, usualGap: 21, remindDays: 28, first: 'Mar 4, 2025', months: [1, 2, 1, 2, 1, 2, 3, 1, 2, 2, 1, 0],
      topics: ['lit review', 'thesis', 'committee', 'methods'], places: [['University library', 5], ['Video call', 4], ['Campus cafe', 2]],
      draft: 'Hi Dr. Okafor, it has been about 5 weeks since we caught up. Last time we talked about tightening the second-language acquisition section. How is that going? I still want to send you the lit review outline.' }
  ];
  var things = [
    { ref: 'm:past-lives', title: 'Past Lives', cat: 'movie', stars: 4.5, first: 'Nov 15, 2026' },
    { ref: 'b:braiding-sweetgrass', title: 'Braiding Sweetgrass', cat: 'book', stars: 4, stoppedAt: 'chapter 7', first: 'Oct 20, 2026' },
    { ref: 't:severance', title: 'Severance', cat: 'tv', stars: null, first: 'Nov 13, 2026' },
    { ref: 'x:hazels-coffee', title: "Hazel's Coffee", cat: 'coffee', stars: 4, first: 'Sep 2, 2026' }
  ];
  // kind: met | note | rated | logged | went.  ref points at a person or a thing.
  var E = [
    ['2026-11-15', '3:50 PM', 'met', 'n:maria-alvarez', { place: 'Lakeside Park', note: 'Walked the lake loop. She is applying for the instructional coach job. Ask how the interview goes.' }],
    ['2026-11-15', '12:30 PM', 'note', 'n:ms-gamilah', { note: 'Ask Ms. Gamilah about WIDA sentence frames for the plate tectonics unit.' }],
    ['2026-11-15', '11:05 AM', 'rated', 'm:past-lives', { stars: 4.5 }],
    ['2026-11-15', '9:40 AM', 'went', 'x:hazels-coffee', { note: 'Grading done early. Try the cardamom latte again.' }],
    ['2026-11-14', '8:40 PM', 'logged', 't:severance', {}],
    ['2026-11-14', '1:15 PM', 'met', 'n:priya-nair', { place: 'farmers market', note: 'She wants to borrow the soil sample kit. Bring the kit Monday.' }],
    ['2026-11-14', '9:05 AM', 'logged', 'b:braiding-sweetgrass', { pos: 'ch. 7' }],
    ['2026-11-13', '7:45 PM', 'logged', 't:severance', {}],
    ['2026-11-13', '4:10 PM', 'note', '', { note: 'Tired after conferences. The maps station ran long.' }],
    ['2026-11-13', '12:20 PM', 'went', 'x:hazels-coffee', { stars: 4, note: 'Good window seat.' }],
    ['2026-11-13', '10:30 AM', 'met', 'n:ms-gamilah', { place: 'school', note: 'Co-planned the rubric language for the lab report.' }],
    ['2026-11-13', '8:05 AM', 'note', '', { note: 'Rubric idea: one row for evidence, one for reasoning.' }],
    ['2026-11-12', '8:30 PM', 'rated', 'b:braiding-sweetgrass', { stars: 4, pos: 'ch. 6', note: 'The chapter on maples and gratitude.' }],
    ['2026-11-12', '3:40 PM', 'met', 'n:ms-gamilah', { place: 'school', note: 'Went through the lab rubric. She suggests fewer criteria and sentence starters.' }],
    ['2026-11-12', '12:10 PM', 'note', '', { note: 'Book the bus for the field trip.' }],
    ['2026-11-12', '7:50 AM', 'note', '', { note: 'Thesis question is getting narrower, which feels right.' }],
    ['2026-11-11', '6:15 PM', 'met', 'n:priya-nair', { place: 'school garden', note: 'Soil pH maps for the garden beds turned out well.' }],
    ['2026-11-11', '2:00 PM', 'note', '', { note: 'Rewrite the plate tectonics rubric with sentence starters.' }],
    ['2026-11-11', '11:30 AM', 'note', '', { note: 'Thesis reading block moved to mornings.' }],
    ['2026-11-11', '8:10 AM', 'note', '', { note: 'Tired, slept badly. Thesis draft can wait a day.' }],
    ['2026-11-10', '4:30 PM', 'met', 'n:maria-alvarez', { place: 'school', note: 'She shared a scoring rubric from her coaching course.' }],
    ['2026-11-10', '12:45 PM', 'went', 'x:hazels-coffee', { stars: 4, note: 'Quiet at lunch.' }],
    ['2026-11-10', '9:00 AM', 'note', '', { note: 'Contour maps lab went better with partners.' }],
    ['2026-11-01', '4:05 PM', 'met', 'n:priya-nair', { place: 'run club', note: 'Easy five miles. Garden club starts in spring.' }],
    ['2026-10-25', '2:20 PM', 'met', 'n:maria-alvarez', { place: 'Lakeside Park', note: 'First talk about the coaching posting.' }],
    ['2026-10-18', '3:40 PM', 'met', 'n:priya-nair', { place: 'run club', note: 'Windy loop around the reservoir.' }],
    ['2026-10-17', '6:30 PM', 'met', 'n:dev-patel', { place: 'climbing gym', note: 'New routes on the back wall. Moving apartments in December.' }],
    ['2026-10-12', '4:30 PM', 'met', 'n:dr-okafor', { place: 'University library', note: 'Walked through the lit review outline. She wants the second-language acquisition section tightened.' }],
    ['2026-10-03', '6:10 PM', 'met', 'n:dev-patel', { place: 'climbing gym', note: 'Finally topped the blue route.' }],
    ['2026-09-21', '9:15 PM', 'note', 'n:dr-okafor', { note: 'Need to send Dr. Okafor the lit review outline.' }],
    ['2026-09-14', '2:00 PM', 'met', 'n:dr-okafor', { place: 'video call', note: 'Committee dates. Thesis question is getting narrower.' }]
  ];
  var events = E.map(function (r, i) {
    var e = { id: 'e' + i, date: r[0], t: r[1], kind: r[2], ref: r[3] };
    for (var k in r[4]) e[k] = r[4][k];
    return e;
  });
  return {
    TODAY: TODAY, NOW_TIME: '4:12 PM', people: people, things: things, events: events,
    week: { entries: 23, before: 19, peopleMet: 6, peopleBefore: 5, rated: 4, ratedBefore: 3, avgStars: 4.1, avgBefore: 3.9, streak: 6,
      perDay: [0, 3, 4, 4, 5, 3, 4], themes: [['rubric', 'Rising', 5, 'with Ms. Gamilah, Maria Alvarez'], ['maps', 'New', 3, 'with Priya Nair'], ['thesis', 'Steady', 3, ''], ['tired', 'Fading', 2, '']] },
    story: 'You logged 23 entries across 6 days. You met 3 people, 3 of them more than once. You rated 4 things, averaging 4.1 stars. Your notes kept coming back to “rubric” and “maps”. That is up from 19 the week before.',
    cats30: [['Person', 'kp', 10], ['Thought', 'kt', 10], ['Places', 'kw', 3], ['TV', 'km', 2], ['Book', 'kb', 2], ['Movie', 'km', 1]],
    notices: [['kp-fg', 'You have met Dr. Okafor 14 times, more than anyone else.'], ['cobalt', 'Sundays are your busiest day for logging.']],
    taste: [['Movie', 4.5, 1, 'km'], ['Book', 4.0, 1, 'kb'], ['Places', 4.0, 1, 'kw']],
    recentSearches: ['rubric', 'lit review', 'Lakeside Park'],
    catalog: [
      { kind: 'movie', title: 'Past Lives (2023)', sub: '', src: 'TMDB', ref: 'm:past-lives' },
      { kind: 'movie', title: 'Past Perfect (2019)', sub: '', src: 'TMDB' },
      { kind: 'tv', title: 'Severance (2022)', sub: '', src: 'TMDB', ref: 't:severance' },
      { kind: 'book', title: 'Braiding Sweetgrass - Robin Wall Kimmerer', sub: '2013', src: 'Open Library', ref: 'b:braiding-sweetgrass' },
      { kind: 'podcast', title: 'The Field Notes Hour', sub: 'Sample Radio', src: 'iTunes' },
      { kind: 'album', title: 'Lake Loop - Morning Sessions', sub: '', src: 'iTunes' },
      { kind: 'song', title: 'Lake Loop - Cardamom', sub: '', src: 'iTunes' },
      { kind: 'recipe', title: 'Cardamom buns', sub: 'Swedish', src: 'TheMealDB' }
    ]
  };
})();
