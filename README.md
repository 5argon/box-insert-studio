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
- Item Stack Simulation : See how many could you fit the same shape items in a given direction, for compartment of cards or coins.
- 3D Preview : Very useful to quickly spot physical UX problems no tools can report, such as hand reachability to grab stuff. Realizing the problem after you buy and cut up the materials seems to be number one source of money waste.
- Maximize Shared Cut Sizes : Tool actively suggests you snap to a certain number to produce as many same dimension cut as possible in the cutting plan.
- Assembly Steps : With some limitations baked in, it is possible to produce formulatic step by step assembly instructions like Ikea furnitures. This would tell you how many sheet of the material you should prepare upfront. You can also choose between different packing algorithm whether you are looking for least amount of sheets or easier time cutting them.

## Feature Overview

- Thins down the material of just the bottom piece of the first tray to increase headroom.
- Can choose between the first level tray being one big tray of several compartments, or separated trays as divided tight fitted on each other.
- Mark compartment as flex or fixed whether it will receive changes when other nearby compartment changes in size or not.
- Mark a compartment as removable box, which adds an another smaller box inside that could be pulled out. If this is too deep to pick up, you can halves it so you get 2 stacked removable boxes instead. This inner box can still be divided as normal.
- Mark any side of a compartment as having finger notch, or lowered height. (Otherwise walls are flushed on the top.)
- Discrete stack of item simulation of either cylinder or box shape to see how many would fit, accounting for any wiggle room. You can choose which way the stack would start from.
- Specify global clearance value that get used in both edge of the box and edge of the removable box.
- Material listing in terms of cut pieces, or a sheet of material you have to buy given a sheet size.
- 3D view can quickly screams UX issues of your finished box.
- Step by step cutting and assembling instructions. You can save this instruction as PDF or download cut list as CSV.
- Save and load JSON file to your computer to keep or share your design.
- Export to OBJ.

## Can't do

- Slanted divider
- Removable box inside removable box (you really want that?)