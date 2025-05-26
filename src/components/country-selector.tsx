import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CountryCode } from "libphonenumber-js";
import { getCountries, getCountryCallingCode } from "libphonenumber-js";

type CountrySelectorProps = {
  value: CountryCode;
  onChange: (value: CountryCode) => void;
};

export function CountrySelector({ value, onChange }: CountrySelectorProps) {
  const [open, setOpen] = useState(false);
  const countries = getCountries();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[180px] justify-between"
        >
          {`${value} (${getCountryCallingCode(value)})`}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-0">
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {countries.map((country) => {
                const callingCode = getCountryCallingCode(country);
                return (
                  <CommandItem
                    key={country}
                    value={[country, callingCode].join(",")}
                    onSelect={(currentValue) => {
                      const [currentCountry] = currentValue.split(",");
                      onChange(currentCountry as CountryCode);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === country ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {`${country} (${callingCode})`}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
