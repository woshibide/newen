# swarm

## website build workflow

this project now includes a small node-based site tool that builds output into dist for both local dev and github pages.

1. install dependencies:
npm install
2. run local dev server with rebuild-on-change:
npm run dev
3. build local static output:
npm run build:local
4. build github pages static output:
npm run build:github

notes:
- local dev serves the generated dist folder on http://localhost:4173 by default.
- github build writes dist/.nojekyll and build-meta.json.
- deploy the contents of dist to github pages.

## docs

- llm/dev structure guide: `llm-architecture.md`

- about 20 seconds of video
- and we need the swarm to be a bit further off, kind of like the video reference of the actual starlings Jurre send you
- I could imagine that prototype is already enough for now, and we then expand on it later
- As I said we only need it for in a type animation for now, 
- but later this year there will be a booth on a fair in which I can imagine we use a live version that does stuff with the camera dolly and the axis etc.


## todo
reimplement in a proper way `applyVisualState` 



## feedback

[x] - font

[x] <<< We dont need to start with newen as a word, we want te particles to be either a n, an e or a w, so together all characters of newen are in the big cloud. Maybe it would be nice if the charecters can be replaced by other ones, so you can overwrite it with j u r r e and make make him very happy?
>>> I'm not exactly sure what you mean with it. Did you checkout controls tab? There is a "shape text" which is responsible for shape in which particles are spawned and also "particles text" which is the text that is used for particles. 

Do you mean that the text that is written in "particles text" would be split into separate glyphs that all fly as one swarm?


I think the Particle text isn’t really relevant, or at least not as one word.. because I want single letters to be floating around. So if that could be split up into characters, that is great. Now because you start with all the N’s in the N spot, and the E’s in the e sport  etc the letters kind of stay in that place of the cloud. If we dont use the begin slide (where you spel out the whole word), the different letters could be scattered more randomly.. does that make sense? 




[x] <<< You now limit yourself to the borders of the frame/window, but that doesn’t mater. It shouldn’t collide with anything, but they should really stay moving around each other like a proper murmuration of starlings.
>>> of course, no probs

ace!




[x] <<< It would be real nice if the toggles could trigger the amount of characters so the cloud gets bigger and more condensed
>>> so like it would start with initial amount of characters and as it progresses amount of particles would like double or quadruple? Otherwise there is a "start particles" slider inside controls tab

That slider makes sense! 


[x] <<< and maybe a toggle for the speed of the flight characters?
>>> of course, no probs

Ace again! 





[x] <<< And it would be awesome if we can move the cloud further and closer, so we can see it ‘from a distance’ like those video’s, or more closer in like the on you had with the parrots? 
>>> of course, no probs
Ace triple! 





[x] <<< Is a ttf file ok or do you need a woff?
>>> yes, TTF and WOFF are both alright. 

I send you the trail TTF, could you work with that for now? 
And could you make the swirl not end? So it has an infinite-ish loop? 

