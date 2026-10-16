# Box Insert Studio

Free web application hosted on GitHub Pages which you can use to design a board game insert constructed from glued up sheet materials. (Foam core, MDF, etc.) The workflow is by defining the dimension of box's inside, then you can subdivide it vertically and horizontally repeatedly in sequence with dividers to create compartments. Each layer is built as one glued tray or as separate trays, and layers can be stacked. There are several traits you can configure to each compartment and the walls and dividers surrounding it, which I will list below.

Aside from this README, this is mostly vibe-coded and I simply don't have resources to write high quality code for this app I'll likely use once for my Arkham Horror LCG box. I'd rather spend time gluing up my box insert and play the game. I hope this is useful to someone out there looking to plan their own dream layout. I know box insert could be highly personal depending on blings of that game you are planning to pack into that box.

The first page is where you work on your design from overhead view.

<img src="screenshots/1.webp" width="600" alt="Layout: top-down plan of the box divided into compartments, with box and material settings on the left, the compartment list on the right, and the cut list below">

The 2nd page you can spin 3D model around to check if it really looks like how you pictured it. What would usually happen here is once you see the height or how close or narrow each compartments are, you realize your hand can't work with it and need to go back to revise the design.

<img src="screenshots/2.webp" width="600" alt="3D view: the insert drawn see-through, with each tray and removable box in its own color">

Check out the final 3rd page for packing simulation of individual pieces and so you know how many sheets of materials you need to buy, along with cutting and assembling instructions.

<img src="screenshots/3.webp" width="600" alt="Cut list & assembly: packing choices for each material and a numbered cutting plan for each sheet">

## How to use it

https://5argon.github.io/box-insert-studio/

Currently there is no detailed manual yet, please figure out on your own by messing with it. Progress is automatically saved in the browser and it survives refreshing without saving. In addition, you can use Save / Open to download / upload `.json` file in your computer of your box design.

There are sample designs to download in the `examples` folder. Download a JSON file, then choose **Open** in the app to load it.

- Arkham Horror: The Card Game, Core Set 2026 box : Starter's Insert
  - [Design A](examples/ahlcg-core-set-2026-starter-s-insert-design-a.insert.json): three 100 mm card slots.
  - [Design B](examples/ahlcg-core-set-2026-starter-s-insert-design-b.insert.json): Design A with the bottom row divided into 81 mm for chaos tokens or core encounter cards, and 119 mm left open.
  - [Design C](examples/ahlcg-core-set-2026-starter-s-insert-design-c.insert.json): Design B with the 119 mm slot holding four stacked removable token trays for every punchboard token except chaos tokens.
  - [Design D1](examples/ahlcg-core-set-2026-starter-s-insert-design-d1.insert.json): Design C with the two columns divided by product, for all Evergreen player cards.
- [Arkham Horror: The Card Game, Core Set 2026 box : Special Insert with Stand Storage](examples/ahlcg-core-set-2026-special-insert-with-stand-storage.insert.json): the Starter's Insert reworked to also hold an act / agenda card stand.
- Arkham Horror: The Card Game, Small Campaign Expansion box
  - [Design A](examples/ahlcg-small-campaign-expansion-design-a.insert.json): two horizontal card rows instead of the original centered column.
  - [Design B](examples/ahlcg-small-campaign-expansion-design-b.insert.json): the vertical column moved to the left, with two small side slots for shared encounter sets.
  - [Design C](examples/ahlcg-small-campaign-expansion-design-c.insert.json): Design B with the long column divided for the scenarios, plus a modular 8 cm slot for Core 2026 encounter sets.

## Demo

To ensure that the calculations are correct and assembly instruction make sense (for a vibe coded app to not be 'AI slop'), I've tested assembling the "Design C" above for real with 5 mm foam board as the material. Everything checks out and I'm quite happy I was able to turn my brain off and just cut and glue as it said, like little kid assembling Lego robots (or adult just coming back from Ikea).

<p>
  <img src="screenshots/demo-7.webp" width="32%" alt="Layout page of Design C: the overhead plan with compartments A to E">
  <img src="screenshots/demo-8.webp" width="32%" alt="3D view of Design C with the two stacked removable boxes highlighted">
</p>

<p>
  <img src="screenshots/demo-1.webp" width="32%" alt="Sheets of 5 mm foam board on the shop shelf">
  <img src="screenshots/demo-2.webp" width="32%" alt="The outer walls and first divider glued on the base, beside the empty game box">
  <img src="screenshots/demo-3.webp" width="32%" alt="More dividers glued in, with the first removable box next to the tray">
  <img src="screenshots/demo-4.webp" width="32%" alt="The tray in the game box, with the two small removable boxes about to go in">
  <img src="screenshots/demo-5.webp" width="32%" alt="The finished insert in the game box, removable boxes stacked in their compartment">
  <img src="screenshots/demo-6.webp" width="32%" alt="The insert in use: cards standing behind dividers and tokens in the removable boxes">
</p>

Though I still take no responsibility if any bug loses you money, this should be quite reassuring?

## Motivations

There are countless problems on even commercial card game boxes how what will or will not fit the contents. Multiple levels of sleeving puffs up the cards. The problem of in-use cards removed from the box causing the remaining contents to fall over. The 3D simulation and the items simulation could help here to iterate your designs. Sometimes an instant you see the 3D model you knew you won't be happy with it for many reasons. I find myself stuck staring and spinning the 3D model around while thinking, I think it's a good feature.

Material has thickness, and this thickness is used both vertically (walls) and horizontally (bases).

Vertically, board game boxes needs a specific headroom space for manuals, or walls not too high for the poked out content to be pickable by hand. It might be initially intuitive that you subtract box's height with desired headroom, then subtract the base thickness, and then you got the height of all the wall pieces you need to cut. But what if you wanted removable compartments where they also have their own base? What if you wanted to add a lid to that compartment where it must be flushed with the outer walls so it must deduct the height from the compartment's wall?

Horizontally, the thickness can cause confusion while gluing which spot / side of wall you are supposed to measure from, a mistake that could cause huge problems when one wall needs to be built from others in sequence. To make it worse, you might want to use multiple thickness in one design. Now you've got a long chain of things that could be screwed up by a few millimeters then result in big trouble later.

There's also clearance space, so all removable compartments (including the main tray) can slide in. I set this to 2mm by default which means 1mm from each sides. These tiny padding can eat into the space you can use more than expected, so a tool that always inform you the remaining space (or eats into only the "flex" compartments you can afford to shrink) could help.

Now we get to the crafting steps, you do want to know how many sheets to buy and see beforehand the packing of pieces you need to cut in a specific sequence. You do need a large enough cutting mat and ruler that crosses those cuts too, so the packing preview might be more useful than you think. If you are working with wood-based material, then these influences how you are going to clamp your work for the sawblades.

These packing also need to account for kerf, which is material lost per cut. A jigsaw blade can be 1 mm thick or more which is the same space as clearance. Getting this wrong might make the fitting too loose or too tight.

There's also the same-piece advantage. Boxes that were designed on a whim might produces many differently sized pieces where they differs in only a few millimeters, which can cause inconveniece while cutting and grouping your pieces. With a proper UI, you can see these and maybe revise your design so it results in as many of the same pieces as possible in the packing.

Normally if you start from cut lists it might not be obvious which one to go for first after the big base. The UI here can suggest steps such that they result in less wastes and more cutting comfort, such as an optimal first-pass rough cuts from your big sheet before you work on each one separately.

Finally the assembly. The steps should tell you exactly how many millimeters from which side to stick a particular piece like it had already reverse-engineered for you that this act would result in the compartment size as designed. This might sound trivial but when you are lost in the sauce of your box working from smaller to larger area, there are many stupid mistakes such as mistaking numbers or forgetting about material thickness. (Or even the thickness of the pencil you used to mark your spot!) So I want every little bit of help here.

## Feature Overview

- Use a thinner secondary material for the bases (the bottom piece of each tray) to increase headroom. The secondary material can also be used for lids, bases of removable boxes and individual dividers, and can have its own sheet size.
- Can choose between each layer being one glued tray of several compartments, or separate trays where every compartment is its own tray, with a gap of half the clearance between neighbours.
- No base: the bottom layer stands on the floor of the box, saving material and giving back the base's height as headroom. The assembly then starts from the walls instead of the base.
- No outer walls: trays have no wall where they meet the box, and the dividers run out to the box's sides instead, for a clear box you still want to see through. Combined with no base, the bottom layer is only dividers glued to each other, standing in the box.
- Mark a compartment's width or depth as Locked or Flex, whether it will receive changes when other nearby compartment changes in size or not.
- Add a removable box to a compartment, an another smaller box inside that could be pulled out. If this is too deep to pick up, you can stack two boxes of half the height instead, or leave out the top one. This box can still be divided as normal, and can have a lid.
- Mark any side of a compartment (the wall or divider there) as having a finger notch, or as a lowered side. (Otherwise walls and dividers are flushed on the top.)
- Item simulation of either box or cylinder shape to see how many would fit in a row, leaving the free space you want. The item direction arrow sets which way they face; items fill from the arrow's tail toward its head.
- Specify global clearance value that get used at the edge of the box, between separate trays, and around removable boxes.
- Cut list of the pieces, and a cutting plan of the sheets of material you have to buy given a sheet size.
- Sheet size, packing, edge trim and kerf are set on the Cut list & assembly page and remembered in your browser instead of saved in the design file, as they depend on the material you can get. Opening a design from someone else keeps your own sheet settings.
- Can cut all removable boxes from sheets of their own in the cutting plan, not mixed with the other pieces, in case you want to make them from a different kind of material of the same thickness. Those sheets can have their own sheet size.
- 3D view can quickly screams UX issues of your finished box.
- Step by step cutting and assembling instructions. You can save this instruction as PDF or download cut list as CSV.
- Save and load JSON file to your computer to keep or share your design.
- Download OBJ models: the whole insert, plus one file per tray and removable box.

## Can't do

- Slanted divider
- Removable box inside removable box (you really want that?)

## Development

To run the app on your own machine or continue developing it, see [development.md](development.md).
