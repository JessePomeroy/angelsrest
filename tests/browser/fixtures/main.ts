import { mount } from "svelte";
import "./styles.css";
import Fixture from "./Fixture.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing fixture mount target");
mount(Fixture, { target });
