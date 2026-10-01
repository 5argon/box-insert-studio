# Box Insert Studio

**DISCLAIMER : In development. I have not finished assembling even one box insert from the output of this app yet. When I do, I'll change this into an image of it. So before then, it is possible that the program has bugs that might result in loss of money from miscutting the materials!**

Free web application hosted on GitHub Pages which you can use to design a board game insert constructed from glued up sheet materials. (Foam core, MDF, etc.) The workflow is by defining the dimension of box's inside, then you can subdivide it vertically and horizontally repeatedly in sequence to create compartments / trays. There are several traits you can configure to each compartment and the walls surrounding it, which I will list below.

Aside from this README, this is mostly vibe-coded and I simply don't have resources to write high quality code for this app I'll likely use once for my Arkham Horror LCG box. I'd rather spend time gluing up my box insert and play the game. I hope this is useful to someone out there looking to plan their own dream layout. I know box insert could be highly personal depending on blings of that game you are planning to pack into that box.

## How to use it

https://5argon.github.io/box-insert-studio/

Currently there is no detailed manual yet, please figure out on your own by messing with it. Progress is automatically saved in the browser and it survives refreshing without saving. In addition, you can use Save / Load to download / upload `.json` file in your computer of your box design.

## Motivations

- Trial and Error : It is hard to estimate whether everything fits or not until everything is in place. I want a playable UI that allow quick experimenting and discovery of new ideas / pivots of design.
- Material Thickness : You wanted to design in terms of slot size, but you don't want to think about adding up material's thickness whether that ended up mathematically checked out within the inside dimension of the box or not.
  - This is not just horizontally, it also affects vertical space as well. You wanted to know how much headroom you have left for game manuals after everything stacked. When removable tray is added (tray within tray), it doubles up the thickness and you often wanted to know the effective height of that inner tray as well. (e.g. Could your hand reach the bottom of it?) More problem if you decided to stack 2 removable trays.
- Clearance : The outermost tray cannot be exactly fitting the inner dimension of the box as it would be too tight. Whether you'll allow 0.5 mm or 1 mm of clearance from each side, you want this accounted in the calculation automatically. Removable tray will also need this clearance once again.
- 3D Preview : Very useful to quickly spot physical UX problems no tools can report, such as hand reachability to grab stuff. Realizing the problem after you buy and cut up the materials seems to be number one source of money waste.
- Maximize Shared Cut Sizes : Tool actively suggests you snap to a certain number to produce as many same dimension cut as possible in the cutting plan.
- Assembly Steps : With some limitations baked in, it is possible to produce formulatic step by step assembly instructions like Ikea furnitures. This would tell you how many sheet of the material you should prepare upfront. You can also choose between different packing algorithm whether you are looking for least amount of sheets or easier time cutting them.

## Terminologies

- Tray : Individual unit you can assemble in isolation before dropping into the box. Nothing designed from this app glues to an actual game box. For example if you divide the box's inside once horizontally, then for the top partition divide once more vertically, into 3 partitions total : You either could have **one** tray of 3 partitions, or **3 trays** each having no partition, fitted in the box tightly. A tray within tray is possible to design in this app.
- Divider : Movable wall created from dividing vertically or horizontally.
- Flex : When you move a divider in your design it'll cause collateral changes due to other dividers sharing limited space. You can mark the size of each **compartment** (not divider) a "flex" or fixed. A flex compartment will get distributed changes whether that's an extra space or reduced space, so that the fixed compartments could stay still. For example, slots you want to have cards inside should be fixed as any other size may not work. But slots for game tokens may be marked as flexible.
